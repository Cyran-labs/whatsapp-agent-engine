'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { DialogFrame } from './dialog-frame';

interface Props {
  email: string;
  orgName: string;
  onClose: () => void;
  /** Envoie la suspension ; renvoie le message d'erreur du moteur, ou null en cas de succès. */
  onConfirm: () => Promise<string | null>;
}

export function SuspendDialog({ email, orgName, onClose, onConfirm }: Props) {
  const t = useTranslations('organisation.users.suspend');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const err = await onConfirm();
    busyRef.current = false;
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <DialogFrame title={t('title', { email })} onClose={onClose}>
      <p className="mb-2.5 text-[13px] text-muted">{t('text', { org: orgName })}</p>
      {error && <p role="alert" className="mb-2 text-[12.5px] text-danger">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} className="h-auto border-border-strong px-[15px] py-2 text-[13px] font-normal">
          {t('cancel')}
        </Button>
        <Button type="button" disabled={busy} onClick={() => void confirm()} className="h-auto bg-danger px-[15px] py-2 text-[13px] font-bold text-white hover:bg-danger/90">
          {t('confirm')}
        </Button>
      </div>
    </DialogFrame>
  );
}
