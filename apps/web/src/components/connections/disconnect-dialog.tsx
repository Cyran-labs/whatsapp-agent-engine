'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { InlineError } from '@/components/feedback/inline-error';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { describeFailure, type DescribedFailure } from '@/lib/describe-failure';
import { sendMutation, type MutationDetail } from '@/lib/api-fetch';
import { accountPath } from './account-path';
import { CancelButton, DangerButton, DialogActions } from './dialog-ui';

interface Props {
  account: WhatsAppAccountView;
  onClose: () => void;
  /** Retrait accepté par le moteur (204). */
  onDone: () => void;
}

interface Refusal {
  failure: DescribedFailure;
  /** Noms des agents IA qui empêchent le retrait (`details[{ path: 'bots.<id>', message: <nom> }]`). */
  bots: string[];
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

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setRefusal(null);
    const result = await sendMutation(`${accountPath(account.id)}/disconnect`, 'POST', undefined, td('failed'), 'Connections');
    busyRef.current = false;
    setBusy(false);
    if ('res' in result) {
      onDone();
      return;
    }
    if (result.orgChanged) return;
    // Panne serveur ou réseau : texte de panne ; refus métier sans clé connue (en anglais) : « Action impossible. »
    const fallback = result.status === 0 || result.status >= 500 ? tr('errors.generic.server') : td('failed');
    const failure = describeFailure(result, { fallback, locale, t: (key) => tr(key), has: (key) => tr.has(key) });
    setRefusal({ failure, bots: botNames(result.details) });
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
