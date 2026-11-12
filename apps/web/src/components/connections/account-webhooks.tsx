'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { MetaHealthIssue, MetaHealthView, WhatsAppWebhooksView } from '@wabagent/contracts';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/feedback/inline-error';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { sendMutation } from '@/lib/api-fetch';
import { describeFailure, type DescribedFailure } from '@/lib/describe-failure';
import { accountPath } from './account-path';
import { CancelButton, DialogActions, PrimaryButton } from './dialog-ui';
import { ProviderTextDetail } from './provider-text';

/** Pages Meta où l'on agit sur l'état du compte (libellés dans les messages, relevés en recette). */
const SECURITY_CENTRE_URL = 'https://business.facebook.com/settings/security';
const WHATSAPP_MANAGER_URL = 'https://business.facebook.com/wa/manage/home/';

/** Codes de problème de Meta dont le sens est traduit (spec R1 §5.6) ; les autres gardent le texte de Meta, replié. */
const BUSINESS_VERIFICATION_CODE = 141010;

/**
 * Vrai si une ligne des webhooks demande d'agir dans Connexions (« Vérifier maintenant » ou « Faire pointer vers
 * WABAGENT ») : l'encart de l'agent IA, sans bouton, donne alors le lien vers Connexions.
 */
export function webhooksNeedAction(webhooks: WhatsAppWebhooksView | null): boolean {
  if (webhooks === null) return false;
  return webhooks.waba !== 'ok' || webhooks.app === 'elsewhere' || webhooks.app === 'failed';
}

type Tone = 'success' | 'warning' | 'danger';

const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-success-soft text-success-ink',
  warning: 'bg-warning-soft text-warning-ink',
  danger: 'bg-danger-soft text-danger-ink',
};

interface Props {
  webhooks: WhatsAppWebhooksView | null;
  metaHealth: MetaHealthView | null;
  accountId: number;
  /** Administrateur de l'organisation : seul à pouvoir agir, donc seul à recevoir le conseil d'agir. */
  isAdmin: boolean;
  /** Lecture seule (encart de l'agent IA, organisation en lecture seule) : aucun bouton. */
  readOnly: boolean;
  /** Relecture de la page après « Faire pointer vers WABAGENT » réussi ; sans elle, pas de bouton. */
  onChanged?: (() => void) | undefined;
  /** Ouvre « Vérifier maintenant » (fenêtre de la carte) ; sans elle, pas de bouton, la phrase reste. */
  onVerify?: (() => void) | undefined;
}

function Line({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <div
      data-webhooks-line=""
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`rounded-lg px-3 py-2 text-[12.5px] ${TONE_CLASS[tone]}`}
    >
      {children}
    </div>
  );
}

function LineButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant="outline" onClick={onClick} className="ml-2.5 h-auto px-2.5 py-[3px] align-baseline text-[12px] font-semibold">
      {children}
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

/**
 * Webhooks inscrits chez Meta et état du compte lu chez Meta (spec R1 §5.6, §6.2), calculés par le moteur : le web ne
 * déduit rien, il dit l'état reçu. Source unique de la carte du compte (Connexions) et de l'encart Numéro de la page de
 * l'agent IA : même phrase aux deux endroits (règle `AccountErrorSentence`), avec des boutons seulement dans Connexions.
 * Un membre qui ne peut pas agir garde la cause et lit « prévenez un administrateur » à la place du conseil.
 * Rien d'affiché pour CM.com et pour un compte retiré (rien n'est lu chez Meta).
 */
export function AccountWebhooks({ webhooks, metaHealth, accountId, isAdmin, readOnly, onChanged, onVerify }: Props) {
  const t = useTranslations('connections.webhooks');
  // La fenêtre vit hors des lignes : la relecture qui enlève la ligne « pointe vers » ne la démonte pas.
  const [repointHost, setRepointHost] = useState<string | null | undefined>(undefined);
  const canWrite = isAdmin && !readOnly;
  const verifyButton = canWrite && onVerify ? <LineButton onClick={onVerify}>{t('verify')}</LineButton> : null;
  const hint = isAdmin ? t('verifyHint') : t('contactAdminHint');
  const sentence = isAdmin ? t('verifySentence') : t('contactAdminSentence');

  const lines: React.ReactNode[] = [];
  if (webhooks !== null) {
    if (webhooks.waba === 'ok') {
      lines.push(<Line key="waba" tone="success"><b className="font-bold">{t('wabaOk')}</b></Line>);
    } else {
      // Ruling R-6 : `unknown` (compte raccordé avant le lot R1, jamais relu) se dit comme tel.
      lines.push(
        <Line key="waba" tone="warning">
          <b className="font-bold">{webhooks.waba === 'missing' ? t('wabaMissing') : t('wabaUnknown')}</b> {hint}
          {verifyButton}
        </Line>,
      );
    }
    if (webhooks.app === 'elsewhere') {
      const host = webhooks.app_host;
      lines.push(
        <Line key="app" tone="warning">
          <b className="font-bold">{host === null ? t('appElsewhereNoHost') : t('appElsewhere', { host })}</b> {t('appAlertsLost')}
          {canWrite && onChanged ? <LineButton onClick={() => setRepointHost(host)}>{t('repoint')}</LineButton> : null}
        </Line>,
      );
    } else if (webhooks.app === 'failed') {
      lines.push(
        <Line key="app" tone="warning">
          <b className="font-bold">{t('appFailed')}</b> {t('appAlertsLost')} {sentence}
          {verifyButton}
        </Line>,
      );
    }
  }
  if (metaHealth !== null) {
    const health = <MetaHealthLine key="health" health={metaHealth} />;
    if (metaHealth.can_send === 'limited' || metaHealth.can_send === 'blocked' || metaHealth.issues.length > 0) lines.push(health);
  }

  return (
    <>
      {lines.length > 0 && (
        <div aria-label={t('label')} role="group" className="space-y-2">
          {lines}
        </div>
      )}
      {repointHost !== undefined && onChanged && (
        <RepointDialog accountId={accountId} host={repointHost} onClose={() => setRepointHost(undefined)} onDone={onChanged} />
      )}
    </>
  );
}

/** État du compte lu chez Meta : envoi limité ou bloqué, causes par code connu, texte de Meta replié sinon, lien utile. */
function MetaHealthLine({ health }: { health: MetaHealthView }) {
  const t = useTranslations('connections.webhooks');
  const head = health.can_send === 'blocked' ? t('sendBlocked') : health.can_send === 'limited' ? t('sendLimited') : t('issuesOnly');
  const needsVerification = health.issues.some((i) => i.code === BUSINESS_VERIFICATION_CODE);
  const hasOther = health.issues.some((i) => i.code !== BUSINESS_VERIFICATION_CODE) || health.issues.length === 0;
  const label = (issue: MetaHealthIssue): string => {
    if (issue.code === BUSINESS_VERIFICATION_CODE) return t('issue141010');
    return issue.code === null ? t('issueUnknown') : t('issueCode', { code: String(issue.code) });
  };
  return (
    <Line tone={health.can_send === 'blocked' ? 'danger' : 'warning'}>
      <b className="font-bold">{head}</b>
      {health.issues.length > 0 && (
        <ul aria-label={t('causesLabel')} className="mt-1 list-disc pl-5">
          {health.issues.map((issue, index) => (
            <li key={`${issue.code ?? 'none'}-${index}`}>
              <span>{label(issue)}</span>
              {issue.code !== BUSINESS_VERIFICATION_CODE && issue.text !== null && <ProviderTextDetail text={issue.text} />}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 flex flex-wrap gap-x-4">
        {needsVerification && <ExternalLink href={SECURITY_CENTRE_URL}>{t('verificationLink')}</ExternalLink>}
        {hasOther && <ExternalLink href={WHATSAPP_MANAGER_URL}>{t('managerLink')}</ExternalLink>}
      </div>
    </Line>
  );
}

type Repoint = { phase: 'confirm' } | { phase: 'running' } | { phase: 'failed'; failure: DescribedFailure } | { phase: 'done' };

/**
 * Confirmation de « Faire pointer vers WABAGENT » (spec R1 §10, question 1) : elle répète le domaine actuel, qui ne
 * recevra plus les événements de l'app. Le moteur décide ; un refus se lit par `describeFailure`, l'état du compte ne
 * change pas (ruling R-15 : le bouton reste). La réussite est dite dans la fenêtre, la page se relit.
 */
function RepointDialog({ accountId, host, onClose, onDone }: { accountId: number; host: string | null; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('connections.webhooks');
  const td = useTranslations('connections.dialogs');
  const tr = useTranslations();
  const locale = useLocale() as 'fr' | 'en';
  const [state, setState] = useState<Repoint>({ phase: 'confirm' });
  const busyRef = useRef(false);
  const busy = state.phase === 'running';

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setState({ phase: 'running' });
    const result = await sendMutation(`${accountPath(accountId)}/app-webhook`, 'POST', undefined, td('failed'), 'Connections');
    busyRef.current = false;
    if ('res' in result) {
      setState({ phase: 'done' });
      onDone();
      return;
    }
    // L'organisation a changé : la page se recharge ; la fenêtre revient à la confirmation, comme `DisconnectDialog`.
    if (result.orgChanged) {
      setState({ phase: 'confirm' });
      return;
    }
    const fallback = result.status === 0 || result.status >= 500 ? tr('errors.generic.server') : td('failed');
    setState({ phase: 'failed', failure: describeFailure(result, { fallback, locale, t: (key) => tr(key), has: (key) => tr.has(key) }) });
  }

  return (
    <DialogFrame title={t('confirmTitle')} onClose={onClose} busy={busy}>
      {state.phase === 'done' ? (
        <p role="status" className="mt-2 text-[13px] font-semibold text-fg">{t('repointed')}</p>
      ) : (
        <p className="mb-2.5 text-[13px] text-muted">{host === null ? t('confirmTextNoHost') : t('confirmText', { host })}</p>
      )}
      {busy && <p aria-busy="true" className="text-[13px] text-muted">{t('repointing')}</p>}
      {state.phase === 'failed' && (
        <div className="mt-2">
          <InlineError message={state.failure.message} reference={state.failure.reference} />
        </div>
      )}
      <DialogActions>
        {state.phase === 'done' ? (
          <CancelButton onClick={onClose}>{td('close')}</CancelButton>
        ) : (
          <>
            <CancelButton busy={busy} onClick={onClose}>{td('cancel')}</CancelButton>
            <PrimaryButton type="button" disabled={busy} onClick={() => void confirm()}>{t('confirm')}</PrimaryButton>
          </>
        )}
      </DialogActions>
    </DialogFrame>
  );
}
