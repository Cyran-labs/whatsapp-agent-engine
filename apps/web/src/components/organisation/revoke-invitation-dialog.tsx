'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/feedback/inline-error';
import type { DescribedFailure } from '@/lib/describe-failure';
import { DialogFrame } from './dialog-frame';

interface Props {
  email: string;
  orgName: string;
  onClose: () => void;
  /** Envoie la révocation ; renvoie le refus à afficher dans la fenêtre, ou null en cas de succès. */
  onConfirm: () => Promise<DescribedFailure | null>;
}

/** Confirmation de la révocation d'une invitation (audit R-20) : le lien envoyé cesse de fonctionner. */
export function RevokeInvitationDialog({ email, orgName, onClose, onConfirm }: Props) {
  const t = useTranslations('organisation.users.revoke');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<DescribedFailure | null>(null);

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const refusal = await onConfirm();
    busyRef.current = false;
    setBusy(false);
    if (refusal) setError(refusal);
  }

  return (
    <DialogFrame title={t('title', { email })} onClose={onClose} busy={busy}>
      <p className="mb-2.5 text-[13px] text-muted">{t('text', { org: orgName })}</p>
      {error && <div className="mb-2"><InlineError message={error.message} reference={error.reference} /></div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={onClose} className="h-auto border-border-strong px-[15px] py-2 text-[13px] font-normal">
          {t('cancel')}
        </Button>
        <Button type="button" disabled={busy} onClick={() => void confirm()} className="h-auto bg-danger px-[15px] py-2 text-[13px] font-bold text-white hover:bg-danger/90">
          {t('confirm')}
        </Button>
      </div>
    </DialogFrame>
  );
}
