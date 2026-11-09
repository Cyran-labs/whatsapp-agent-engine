'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * Relecture en échec après une écriture réussie (audit §5.1) : bandeau de page au-dessus du contenu, qui reste tel que
 * lu en dernier. L'écriture, elle, a réussi : le texte ne parle pas d'échec de l'action. « Réessayer » relance la lecture.
 */
export function StaleBanner({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations();
  return (
    <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 text-[13px] text-muted shadow-sm">
      <span>{t('feedback.stale')}</span>
      <Button type="button" variant="outline" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}
