'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { InlineError } from '@/components/feedback/inline-error';
import { useDescribeFailure } from '@/components/feedback/use-describe-failure';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { sendMutation } from '@/lib/api-fetch';
import type { DescribedFailure } from '@/lib/describe-failure';
import { accountPath } from './account-path';
import { CancelButton, DialogActions, INPUT, LABEL, PrimaryButton } from './dialog-ui';

interface Props {
  account: WhatsAppAccountView;
  onClose: () => void;
  /** Renommage accepté par le moteur. */
  onDone: () => void;
}

export function RenameAccountDialog({ account, onClose, onDone }: Props) {
  const t = useTranslations('connections.rename');
  const td = useTranslations('connections.dialogs');
  const describe = useDescribeFailure();
  const fieldId = useId();
  const [name, setName] = useState(account.name);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<DescribedFailure | null>(null);

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
      const failure = describe(result, td('failed'), ['name']);
      setError(failure);
      // contre-audit D-3 (audit §5.1) : un refus qui porte sur le nom ramène le focus au champ.
      if (failure.fieldErrors.name !== undefined) document.getElementById(fieldId)?.focus();
    }
  }

  return (
    <DialogFrame title={t('title')} onClose={onClose} busy={busy}>
      <form onSubmit={(e) => void submit(e)}>
        <label htmlFor={fieldId} className={`${LABEL} mt-3`}>{t('label')}</label>
        <input
          id={fieldId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={INPUT}
          autoComplete="off"
          aria-invalid={error?.fieldErrors.name !== undefined ? true : undefined}
        />
        {/* Erreur de champ renvoyée par la validation (« Le nom est requis. ») : son message prime sur « Données invalides ». */}
        {error && (
          <div className="mt-2">
            <InlineError message={error.fieldErrors.name ?? error.message} reference={error.reference} />
          </div>
        )}
        <DialogActions>
          <CancelButton busy={busy} onClick={onClose}>{td('cancel')}</CancelButton>
          <PrimaryButton type="submit" disabled={busy}>{t('save')}</PrimaryButton>
        </DialogActions>
      </form>
    </DialogFrame>
  );
}
