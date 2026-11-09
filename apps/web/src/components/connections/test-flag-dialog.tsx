'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountView, WhatsAppNumberView } from '@wabagent/contracts';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { formatPhone } from '@/lib/whatsapp-display';
import { sendMutation } from '@/lib/api-fetch';
import { accountPath } from './account-path';
import { CancelButton, DialogActions, ErrorLine, PrimaryButton } from './dialog-ui';

interface Props {
  account: WhatsAppAccountView;
  number: WhatsAppNumberView;
  onClose: () => void;
  /** Marquage accepté par le moteur. */
  onDone: () => void;
}

/** Marque ou démarque un numéro de test (Meta ne le déclare pas) ; le moteur décide. */
export function TestFlagDialog({ account, number, onClose, onDone }: Props) {
  const t = useTranslations('connections.testFlag');
  const td = useTranslations('connections.dialogs');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const next = !number.is_test;
  const prefix = next ? 'mark' : 'unmark';

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const result = await sendMutation(`${accountPath(account.id)}/numbers/${number.id}`, 'PATCH', { is_test: next }, td('failed'), 'Connections');
    busyRef.current = false;
    setBusy(false);
    if ('res' in result) onDone();
    else if (!result.orgChanged) setError(result.error);
  }

  return (
    <DialogFrame title={t(`${prefix}Title`, { number: formatPhone(number.phone_e164) })} onClose={onClose} busy={busy}>
      <p className="mb-2.5 text-[13px] text-muted">{t(`${prefix}Text`)}</p>
      {error && <ErrorLine>{error}</ErrorLine>}
      <DialogActions>
        <CancelButton busy={busy} onClick={onClose}>{td('cancel')}</CancelButton>
        <PrimaryButton type="button" disabled={busy} onClick={() => void confirm()}>{t(`${prefix}Confirm`)}</PrimaryButton>
      </DialogActions>
    </DialogFrame>
  );
}
