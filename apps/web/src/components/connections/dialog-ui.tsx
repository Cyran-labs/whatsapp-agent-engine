'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export const INPUT = 'w-full rounded-lg border border-border-strong bg-surface px-[13px] py-2.5 text-[13.5px] text-fg';
export const LABEL = 'mb-1.5 block text-[13px] font-semibold';
const BUTTON = 'h-auto px-[15px] py-2 text-[13px]';

export function DialogActions({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 flex justify-end gap-2">{children}</div>;
}

/** Bouton Annuler ou Fermer d'une fenêtre ; `busy` (envoi en cours) le désactive et dit pourquoi (audit R-22). */
export function CancelButton({ onClick, busy = false, children }: { onClick: () => void; busy?: boolean; children: React.ReactNode }) {
  const t = useTranslations('common');
  const reasonId = useId();
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        title={busy ? t('sending') : undefined}
        aria-describedby={busy ? reasonId : undefined}
        onClick={onClick}
        className={`${BUTTON} border-border-strong font-normal`}
      >
        {children}
      </Button>
      {busy && <span id={reasonId} className="sr-only">{t('sending')}</span>}
    </>
  );
}

type ActionProps = Omit<React.ComponentProps<typeof Button>, 'className' | 'variant' | 'size'>;

export function PrimaryButton(props: ActionProps) {
  return <Button {...props} className={`${BUTTON} font-bold`} />;
}

export function DangerButton(props: ActionProps) {
  return <Button {...props} className={`${BUTTON} bg-danger font-bold text-white hover:bg-danger/90`} />;
}

export function ErrorLine({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="mt-2 text-[12.5px] text-danger">{children}</p>;
}
