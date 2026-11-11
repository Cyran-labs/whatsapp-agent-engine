'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { Button } from '@/components/ui/button';
import { daysUntil, formatPhone, metaAppUrl, whatsAppManagerUrl } from '@/lib/whatsapp-display';
import { hasUnreadableCredentials, reasonSentence } from './account-error';
import { ProviderTextDetail, TextDetail } from './provider-text';

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

/** Bouton « Remplacer les identifiants » des bandeaux (erreur, jeton qui expire) : la fenêtre de la carte. */
function ReplaceCredentialsButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations('connections.alerts');
  return (
    <Button type="button" variant="outline" onClick={onClick} className="ml-2.5 h-auto px-2.5 py-[3px] align-baseline text-[12px] font-semibold">
      {t('errorReplace')}
    </Button>
  );
}

/** Bouton « Vérifier maintenant » du bandeau d'erreur de Connexions : la fenêtre de vérification de la carte (recette 3.6). */
function VerifyButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations('connections.alerts');
  return (
    <Button type="button" variant="outline" onClick={onClick} className="ml-2.5 h-auto px-2.5 py-[3px] align-baseline text-[12px] font-semibold">
      {t('errorVerify')}
    </Button>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
      {children}
    </a>
  );
}

/** Ce que la phrase d'erreur lit d'un compte : la vue du compte et le compte du résumé de numéro d'un agent IA en portent les mêmes champs. */
export type AccountErrorFacts = Pick<WhatsAppAccountView, 'mode' | 'error_reason' | 'error_cause' | 'error_detail'> & { provider_text?: string | null };

/**
 * Phrase d'erreur d'un compte (motif précis du moteur et conseil propre à la cause `error_cause`, audit R-5) :
 * « Contactez le support » (`support`), « Remplacez les identifiants » (`credentials`), « Retirez le compte puis
 * raccordez-le de nouveau » (`reconnect`, sans bouton Remplacer). Le message du fournisseur
 * (`provider_text`) est replié ; en anglais, le motif du moteur (en français) l'est aussi, jamais affiché en clair.
 * Partagée par Connexions et la page de l'agent IA (contre-audit D-1). Sans `onReplaceCredentials`, pas de bouton.
 * `canAct` faux (un membre qui ne peut ni ouvrir Connexions ni remplacer les identifiants) : la cause et le motif restent,
 * le conseil qu'il ne peut pas suivre (« Remplacez les identifiants », « Vérifiez le secret », « Lancez Vérifier ») disparaît.
 *
 * `wording` `banner` : bandeau de Connexions (recette 3.6, choix C-12), où « Vérifier maintenant » est à portée (bouton
 * du bandeau avec `onVerify`, entrée du menu « Gérer » sinon). La tête dit « La dernière vérification du compte a
 * échoué. » au lieu de « Le compte est en erreur. » ; une erreur d'identifiants (cause `credentials`, motifs
 * `token_invalid` et `signature_rejected`) conseille de vérifier de nouveau, puis de remplacer les identifiants si cela
 * continue ; une cause inconnue, de vérifier de nouveau pour connaître le motif ; `support` et `reconnect` gardent
 * leur conseil. `panel` (défaut) : encart Numéro de la page de l'agent IA, textes inchangés.
 */
export function AccountErrorSentence({
  account,
  onReplaceCredentials,
  canAct = true,
  wording = 'panel',
  onVerify,
}: {
  account: AccountErrorFacts;
  onReplaceCredentials?: (() => void) | undefined;
  canAct?: boolean;
  wording?: 'banner' | 'panel';
  onVerify?: (() => void) | undefined;
}) {
  const t = useTranslations('connections.alerts');
  const locale = useLocale();
  const reason = account.error_reason ?? 'other';
  const banner = wording === 'banner';
  const actions = (
    <>
      {canAct && onVerify ? <VerifyButton onClick={onVerify} /> : null}
      {onReplaceCredentials ? <ReplaceCredentialsButton onClick={onReplaceCredentials} /> : null}
    </>
  );
  const verifyOnly = canAct && onVerify ? <VerifyButton onClick={onVerify} /> : null;
  let head: string;
  let hint: React.ReactNode = null;
  if (reason === 'token_invalid') {
    head = account.mode === 'meta_manual' ? t('errorTokenInvalid') : t('errorTokenInvalidCm');
    hint = canAct ? <>{banner ? t('errorRetryThenReplace') : t('errorTokenInvalidHint')}{actions}</> : null;
  } else if (reason === 'signature_rejected') {
    head = t('errorSignatureRejected');
    hint = canAct ? <>{banner ? t('errorRetryThenReplace') : t('errorSignatureRejectedHint')}{actions}</> : null;
  } else {
    // La cause vient du moteur (`error_cause`) : le web ne lit pas le texte du motif pour la deviner.
    const cause = account.error_cause;
    const detail = account.error_detail;
    // Le motif du moteur est en français : en clair en français, replié en anglais (jamais « Reason : » en français).
    const motif = detail !== null && locale === 'fr' ? `${t('errorReason', { detail: reasonSentence(detail) })} ` : '';
    if (cause === 'support') {
      // App ou compte qui ne peut pas être raccordé : texte neutre, aucune reprise automatique ni bouton de remplacement.
      head = t('errorSupport');
      hint = verifyOnly;
    } else {
      head = banner ? t('errorLastCheckFailed') : t('errorOther');
      if (cause === 'credentials') hint = <>{motif}{canAct ? <>{banner ? t('errorRetryThenReplace') : t('errorReplaceHint')}{actions}</> : null}</>;
      // Identifiants enregistrés illisibles : le moteur refuse de les remplacer (409 `secrets_unreadable`), donc
      // jamais le bouton Remplacer ; seul un administrateur peut retirer le compte et le raccorder (revue finale M-1).
      else if (cause === 'reconnect') hint = <>{motif}{canAct ? <>{t('errorReconnectHint')}{verifyOnly}</> : null}</>;
      else hint = canAct ? <>{banner ? t('errorRetryForReason') : t('errorUnknownHint')}{verifyOnly}</> : null;
    }
  }
  return (
    <>
      <b className="font-bold">{head}</b> {hint}
      {locale !== 'fr' && reason === 'other' && account.error_cause !== 'support' && account.error_detail !== null && (
        <TextDetail summary={t('engineDetail')} text={account.error_detail} />
      )}
      {account.provider_text != null && <ProviderTextDetail text={account.provider_text} />}
    </>
  );
}

interface Props {
  account: WhatsAppAccountView;
  now: Date;
  /** Ouvre « Remplacer les identifiants » : sans elle, un bandeau qui demande de les remplacer n'a pas de bouton. */
  onReplaceCredentials?: (() => void) | undefined;
  /** Ouvre la vérification du compte (la fenêtre du menu « Gérer ») : sans elle, le bandeau d'erreur n'a pas ce bouton. */
  onVerify?: (() => void) | undefined;
}

/**
 * Bandeaux d'alerte d'un compte : erreur, jeton qui expire, alertes du fournisseur, qualité, numéro de test.
 * Le bandeau d'erreur dit le motif précis du moteur et un conseil propre à la cause `error_cause` (audit R-5) :
 * « Contactez le support » (`support`), « Remplacez les identifiants » (`credentials`), « Retirez le compte puis
 * raccordez-le de nouveau » (`reconnect`). Le message du fournisseur
 * (`provider_text`) est replié ; en anglais, le motif du moteur (en français) l'est aussi, jamais affiché en clair.
 */
export function AccountAlerts({ account, now, onReplaceCredentials, onVerify }: Props) {
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
  // Bandeau d'expiration : même bouton que le bandeau d'erreur (spec 10.7), sauf identifiants illisibles, que le moteur
  // refuse de remplacer : la seule suite est de retirer le compte et de le raccorder (relecture tâche 10, I-2).
  const unreadable = hasUnreadableCredentials(account);
  const replaceButton = onReplaceCredentials && !unreadable ? <ReplaceCredentialsButton onClick={onReplaceCredentials} /> : null;
  const expiringHint = unreadable
    ? t('errorReconnectHint')
    : replaceButton
      ? <>{t('tokenExpiringHintAction')}{replaceButton}</>
      : t('tokenExpiringHint');

  if (account.state === 'error') {
    banners.push({
      key: 'error',
      tone: 'danger',
      icon: '⚠',
      body: <AccountErrorSentence account={account} onReplaceCredentials={onReplaceCredentials} wording="banner" onVerify={onVerify} />,
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
              <b className="font-bold">{t('tokenExpiring', { count: daysUntil(alert.at, now) })}</b>{' '}
              {expiringHint}
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
