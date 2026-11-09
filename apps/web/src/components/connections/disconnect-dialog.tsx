'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { sendMutation, type MutationDetail } from '@/lib/api-fetch';
import { accountPath } from './account-path';
import { CancelButton, DangerButton, DialogActions, ErrorLine } from './dialog-ui';

interface Props {
  account: WhatsAppAccountView;
  onClose: () => void;
  /** Déconnexion acceptée par le moteur (204). */
  onDone: () => void;
}

interface Refusal {
  message: string;
  /** Noms des agents IA qui empêchent la déconnexion (`details[{ path: 'bots.<id>', message: <nom> }]`). */
  bots: string[];
}

function botNames(details: readonly MutationDetail[]): string[] {
  return details.filter((d) => d.path.startsWith('bots.') && d.message).map((d) => d.message as string);
}

export function DisconnectDialog({ account, onClose, onDone }: Props) {
  const t = useTranslations('connections.disconnect');
  const td = useTranslations('connections.dialogs');
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
    if ('res' in result) onDone();
    else if (!result.orgChanged) setRefusal({ message: result.error, bots: botNames(result.details) });
  }

  return (
    <DialogFrame title={t('title', { name: account.name })} onClose={onClose}>
      <p className="mb-2.5 text-[13px] text-muted">{t('text')}</p>
      {refusal && (
        <>
          <ErrorLine>{refusal.message}</ErrorLine>
          {refusal.bots.length > 0 && (
            <ul aria-label={t('botsLabel')} className="mt-1.5 list-disc pl-5 text-[12.5px] text-fg">
              {refusal.bots.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}
            </ul>
          )}
        </>
      )}
      <DialogActions>
        <CancelButton onClick={onClose}>{td('cancel')}</CancelButton>
        <DangerButton type="button" disabled={busy} onClick={() => void confirm()}>{t('confirm')}</DangerButton>
      </DialogActions>
    </DialogFrame>
  );
}
