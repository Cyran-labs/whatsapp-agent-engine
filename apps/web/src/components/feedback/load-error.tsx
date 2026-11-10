'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** État d'un panneau relu à la main : lecture en cours, et nombre de réessais qui ont échoué depuis l'affichage du panneau. */
export interface RetryState {
  busy: boolean;
  failures: number;
}

/**
 * Échec de lecture d'une page ou d'un panneau (audit §5.1) : à la place du contenu, avec « Réessayer ». Dans un
 * panneau, le reste de la page s'affiche. `retry` : pendant la relecture le bouton est désactivé et dit pourquoi ; un
 * réessai en échec redit « Nouvel essai en échec. » (le texte disparaît pendant la relecture, donc il est annoncé de nouveau
 * à chaque échec).
 */
export function LoadError({ message, onRetry, retry }: { message: string; onRetry: () => void; retry?: RetryState }) {
  const t = useTranslations('common');
  const reasonId = useId();
  const busy = retry?.busy ?? false;
  const failures = retry?.failures ?? 0;
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-5 text-[13px] text-muted shadow-sm">
      <span>
        {message}
        {failures > 0 && !busy && <span className="mt-1 block text-[12.5px] text-danger">{t('retryFailed')}</span>}
        {busy && <span id={reasonId} className="mt-1 block text-[12.5px] text-muted">{t('retrying')}</span>}
      </span>
      <Button type="button" variant="outline" disabled={busy} aria-describedby={busy ? reasonId : undefined} onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}
