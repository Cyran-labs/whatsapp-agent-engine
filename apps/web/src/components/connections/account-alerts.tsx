'use client';

import { useTranslations } from 'next-intl';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { Button } from '@/components/ui/button';
import { daysUntil, formatPhone, metaAppUrl, whatsAppManagerUrl } from '@/lib/whatsapp-display';
import { reasonSentence } from './account-error';
import { ProviderTextDetail, rawMetaText } from './provider-text';

type Tone = 'warning' | 'danger' | 'info';

const TONE_CLASS: Record<Tone, string> = {
  warning: 'bg-warning-soft text-warning-ink',
  danger: 'bg-danger-soft text-danger-ink',
  info: 'bg-tertiary-soft text-tertiary-ink',
};

interface Banner {
  key: string;
  tone: Tone;
  icon: string;
  body: React.ReactNode;
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
      {children}
    </a>
  );
}

interface Props {
  account: WhatsAppAccountView;
  now: Date;
  /** Ouvre « Remplacer les identifiants » : sans elle, un bandeau qui demande de les remplacer n'a pas de bouton. */
  onReplaceCredentials?: (() => void) | undefined;
}

/**
 * Bandeaux d'alerte d'un compte : erreur, jeton qui expire, alertes du fournisseur, qualité, numéro de test.
 * Le bandeau d'erreur dit le motif précis du moteur et un conseil propre à la cause `error_cause` (audit R-5) :
 * « Contactez le support » (`support`), « Remplacez les identifiants » (`credentials`), la reprise automatique
 * seulement pour une panne du fournisseur (`provider`).
 */
export function AccountAlerts({ account, now, onReplaceCredentials }: Props) {
  const t = useTranslations('connections.alerts');
  const provider = account.mode === 'meta_manual' ? 'Meta' : 'CM.com';
  const managerUrl = account.mode === 'meta_manual' && account.waba_id ? whatsAppManagerUrl(account.waba_id) : null;
  const managerLink = managerUrl ? (
    <>
      {' '}
      <ExternalLink href={managerUrl}>{t('manager')}</ExternalLink>
    </>
  ) : null;

  const banners: Banner[] = [];

  if (account.state === 'error') {
    const reason = account.error_reason ?? 'other';
    const raw = rawMetaText(account.error_detail);
    const replaceButton = onReplaceCredentials ? (
      <Button type="button" variant="outline" onClick={onReplaceCredentials} className="ml-2.5 h-auto px-2.5 py-[3px] align-baseline text-[12px] font-semibold">
        {t('errorReplace')}
      </Button>
    ) : null;
    let head: string;
    let hint: React.ReactNode = null;
    if (reason === 'token_invalid') {
      head = account.mode === 'meta_manual' ? t('errorTokenInvalid') : t('errorTokenInvalidCm');
      hint = <>{t('errorTokenInvalidHint')}{replaceButton}</>;
    } else if (reason === 'signature_rejected') {
      head = t('errorSignatureRejected');
      hint = <>{t('errorSignatureRejectedHint')}{replaceButton}</>;
    } else {
      // La cause vient du moteur (`error_cause`) : le web ne lit pas le texte du motif pour la deviner.
      const cause = account.error_cause;
      const detail = account.error_detail;
      const motif = detail !== null && raw === null ? `${t('errorReason', { detail: reasonSentence(detail) })} ` : '';
      if (cause === 'support') {
        // App ou compte qui ne peut pas être raccordé : texte neutre, aucune reprise automatique ni bouton de remplacement.
        head = t('errorSupport');
      } else {
        head = t('errorOther');
        if (cause === 'provider') hint = <>{motif}{t('errorUnavailableHint')}</>;
        else if (cause === 'credentials') hint = <>{motif}{t('errorReplaceHint')}{replaceButton}</>;
        else hint = t('errorUnknownHint');
      }
    }
    banners.push({
      key: 'error',
      tone: 'danger',
      icon: '⚠',
      body: (
        <>
          <b className="font-bold">{head}</b> {hint}
          {raw !== null && <ProviderTextDetail text={raw} />}
        </>
      ),
    });
  }

  account.alerts.forEach((alert, index) => {
    const key = `${alert.kind}-${index}`;
    switch (alert.kind) {
      case 'token_expiring':
        banners.push({
          key,
          tone: 'warning',
          icon: '⚠',
          body: (
            <>
              <b className="font-bold">{t('tokenExpiring', { count: daysUntil(alert.at, now) })}</b> {t('tokenExpiringHint')}
            </>
          ),
        });
        break;
      case 'quality_degraded': {
        const number = account.numbers.find((n) => n.id === alert.number_id);
        if (!number) break;
        banners.push({
          key,
          tone: 'warning',
          icon: '⚠',
          body: (
            <>
              <b className="font-bold">{t('qualityDegraded', { number: formatPhone(number.phone_e164) })}</b> {t('qualityDegradedHint')}
            </>
          ),
        });
        break;
      }
      case 'payment':
      case 'account_locked':
      case 'policy_block':
      case 'account_update': {
        const text = {
          payment: t('payment', { provider }),
          account_locked: t('accountLocked', { provider }),
          policy_block: t('policyBlock', { provider }),
          account_update: t('accountUpdate', { provider }),
        }[alert.kind];
        banners.push({
          key,
          tone: alert.kind === 'account_locked' || alert.kind === 'policy_block' ? 'danger' : 'warning',
          icon: '⚠',
          body: (
            <>
              <b className="font-bold">{text}</b>
              {managerLink}
            </>
          ),
        });
        break;
      }
    }
  });

  // Dès qu'un numéro présent du compte est de test (spec §2.4, §9.1) : une seule fois par compte.
  if (account.mode === 'meta_manual' && account.numbers.some((n) => n.is_test && n.provider_state === 'present')) {
    banners.push({
      key: 'test',
      tone: 'info',
      icon: 'ⓘ',
      body: (
        <>
          <b className="font-bold">{t('testNumber')}</b> {t('testNumberHint')}{' '}
          <ExternalLink href={metaAppUrl(account.meta_app_id)}>{t('testRecipients')}</ExternalLink>
        </>
      ),
    });
  }

  if (banners.length === 0) return null;
  return (
    <div>
      {banners.map((b) => (
        <div
          key={b.key}
          role={b.tone === 'danger' ? 'alert' : 'status'}
          className={`flex items-start gap-2.5 border-t border-border px-[18px] py-2.5 text-[12.5px] ${TONE_CLASS[b.tone]}`}
        >
          <span aria-hidden="true">{b.icon}</span>
          <div>{b.body}</div>
        </div>
      ))}
    </div>
  );
}
