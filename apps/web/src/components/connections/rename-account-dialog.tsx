'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { sendMutation } from '@/lib/api-fetch';
import { accountPath } from './account-path';
import { CancelButton, DialogActions, ErrorLine, INPUT, LABEL, PrimaryButton } from './dialog-ui';

interface Props {
  account: WhatsAppAccountView;
  onClose: () => void;
  /** Renommage accepté par le moteur. */
  onDone: () => void;
}

export function RenameAccountDialog({ account, onClose, onDone }: Props) {
  const t = useTranslations('connections.rename');
  const td = useTranslations('connections.dialogs');
  const fieldId = useId();
  const [name, setName] = useState(account.name);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const result = await sendMutation(accountPath(account.id), 'PATCH', { name }, td('failed'), 'Connections');
    busyRef.current = false;
    setBusy(false);
    if ('res' in result) onDone();
    else if (!result.orgChanged) {
      // Erreur de champ renvoyée par la validation (« Le nom est requis. ») : son message prime sur « Données invalides ».
      setError(result.details.find((d) => d.path === 'name')?.message ?? result.error);
    }
  }

  return (
    <DialogFrame title={t('title')} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <label htmlFor={fieldId} className={`${LABEL} mt-3`}>{t('label')}</label>
        <input id={fieldId} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} autoComplete="off" />
        {error && <ErrorLine>{error}</ErrorLine>}
        <DialogActions>
          <CancelButton onClick={onClose}>{td('cancel')}</CancelButton>
          <PrimaryButton type="submit" disabled={busy}>{t('save')}</PrimaryButton>
        </DialogActions>
      </form>
    </DialogFrame>
  );
}
