'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * Échec de lecture d'une page ou d'un panneau (audit §5.1) : à la place du contenu, avec « Réessayer ». Dans un
 * panneau, le reste de la page s'affiche.
 */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTranslations('common');
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-5 text-[13px] text-muted shadow-sm">
      <span>{message}</span>
      <Button type="button" variant="outline" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}
