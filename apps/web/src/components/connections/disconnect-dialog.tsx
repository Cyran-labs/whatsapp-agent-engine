'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { WhatsAppAccountDisconnected, WhatsAppAccountView } from '@wabagent/contracts';
import { InlineError } from '@/components/feedback/inline-error';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { describeFailure, type DescribedFailure } from '@/lib/describe-failure';
import { readJsonBody, sendMutation, type MutationDetail } from '@/lib/api-fetch';
import { accountPath } from './account-path';
import { CancelButton, DangerButton, DialogActions } from './dialog-ui';

interface Props {
  account: WhatsAppAccountView;
  onClose: () => void;
  /**
   * Retrait accepté par le moteur : tout de suite, ou à la fermeture quand la fenêtre a un bilan à dire. `repointedTo` :
   * compte vers lequel le webhook de l'app pointe maintenant, à dire dans la notification (null si la fenêtre l'a dit).
   */
  onDone: (repointedTo: string | null) => void;
}

interface Refusal {
  failure: DescribedFailure;
  /** Noms des agents IA qui empêchent le retrait (`details[{ path: 'bots.<id>', message: <nom> }]`). */
  bots: string[];
}

const WABA_CLEANUPS: readonly string[] = ['done', 'failed', 'other_address', 'not_applicable'];
const APP_WEBHOOKS: readonly string[] = ['repointed', 'left', 'unknown', 'not_applicable'];

/** Bilan du retrait renvoyé par le moteur (200) ; null pour un corps absent (204) ou d'une autre forme. */
function readOutcome(body: unknown): WhatsAppAccountDisconnected | null {
  if (typeof body !== 'object' || body === null) return null;
  const { waba_cleanup: cleanup, app_webhook: app, repointed_to: repointedTo } = body as Record<string, unknown>;
  if (typeof cleanup !== 'string' || !WABA_CLEANUPS.includes(cleanup)) return null;
  if (typeof app !== 'string' || !APP_WEBHOOKS.includes(app)) return null;
  return {
    waba_cleanup: cleanup as WhatsAppAccountDisconnected['waba_cleanup'],
    app_webhook: app as WhatsAppAccountDisconnected['app_webhook'],
    ...(app === 'repointed' && typeof repointedTo === 'string' && repointedTo !== '' ? { repointed_to: repointedTo } : {}),
  };
}

function botNames(details: readonly MutationDetail[]): string[] {
  return details.filter((d) => d.path.startsWith('bots.') && d.message).map((d) => d.message as string);
}

/** Fenêtre « Retirer le compte {compte} ? » (recette Q-5 : « Déconnecter » se confondait avec « Se déconnecter »). */
export function DisconnectDialog({ account, onClose, onDone }: Props) {
  const t = useTranslations('connections.disconnect');
  const td = useTranslations('connections.dialogs');
  const tr = useTranslations();
  const locale = useLocale() as 'fr' | 'en';
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // Bilan à dire après un retrait réussi (spec R1 §5.5) : la fenêtre reste ouverte, la page se relit à sa fermeture.
  const [outcome, setOutcome] = useState<WhatsAppAccountDisconnected | null>(null);

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setRefusal(null);
    const result = await sendMutation(`${accountPath(account.id)}/disconnect`, 'POST', undefined, td('failed'), 'Connections');
    if ('res' in result) {
      const done = readOutcome(await readJsonBody<unknown>(result.res));
      busyRef.current = false;
      setBusy(false);
      if (done !== null && (done.app_webhook === 'left' || done.app_webhook === 'unknown' || done.waba_cleanup === 'failed' || done.waba_cleanup === 'other_address')) setOutcome(done);
      // Relecture finale R1 FR-M7 : rien d'autre à dire, la fenêtre se ferme et la notification dit le repointage.
      else onDone(done?.repointed_to ?? null);
      return;
    }
    busyRef.current = false;
    setBusy(false);
    if (result.orgChanged) return;
    // Panne serveur ou réseau : texte de panne ; refus métier sans clé connue (en anglais) : « Action impossible. »
    const fallback = result.status === 0 || result.status >= 500 ? tr('errors.generic.server') : td('failed');
    const failure = describeFailure(result, { fallback, locale, t: (key) => tr(key), has: (key) => tr.has(key) });
    setRefusal({ failure, bots: botNames(result.details) });
  }

  if (outcome !== null) {
    // Le bilan est dit ici : la notification de la page ne le répète pas.
    const finish = () => onDone(null);
    return (
      <DialogFrame title={t('doneTitle', { name: account.name })} onClose={finish}>
        <div role="status" className="mt-2 text-[13px] text-fg">
          {outcome.waba_cleanup === 'failed' && <p className="mt-1.5 text-warning-ink">{t('wabaCleanupFailed')}</p>}
          {/* Audit des décisions R1, F-1 : une adresse qui n'est pas celle du compte n'est jamais touchée. */}
          {outcome.waba_cleanup === 'other_address' && <p className="mt-1.5 text-warning-ink">{t('wabaOtherAddress')}</p>}
          {outcome.app_webhook === 'left' && <p className="mt-1.5 text-warning-ink">{t('appWebhookLeft')}</p>}
          {/* Audit des décisions R1 P-4 : webhook de l'app non lu, phrase prudente (jamais « pointe encore »). */}
          {outcome.app_webhook === 'unknown' && <p className="mt-1.5 text-warning-ink">{t('appWebhookUnknown')}</p>}
          {outcome.repointed_to !== undefined && <p className="mt-1.5">{t('appWebhookRepointed', { name: outcome.repointed_to })}</p>}
        </div>
        <DialogActions>
          <CancelButton onClick={finish}>{td('close')}</CancelButton>
        </DialogActions>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame title={t('title', { name: account.name })} onClose={onClose} busy={busy}>
      <p className="mb-2.5 text-[13px] text-muted">{t('text')}</p>
      {refusal && (
        <div className="mt-2">
          <InlineError message={refusal.failure.message} reference={refusal.failure.reference} />
          {refusal.bots.length > 0 && (
            <ul aria-label={t('botsLabel')} className="mt-1.5 list-disc pl-5 text-[12.5px] text-fg">
              {refusal.bots.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}
            </ul>
          )}
        </div>
      )}
      <DialogActions>
        <CancelButton busy={busy} onClick={onClose}>{td('cancel')}</CancelButton>
        <DangerButton type="button" disabled={busy} onClick={() => void confirm()}>{t('confirm')}</DangerButton>
      </DialogActions>
    </DialogFrame>
  );
}
