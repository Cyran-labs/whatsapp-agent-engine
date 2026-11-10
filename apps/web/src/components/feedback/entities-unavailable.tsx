'use client';

import { useTranslations } from 'next-intl';

/**
 * Ligne discrète du rail quand la liste des entités est illisible (audit R-18) : elle remplace le regroupement par
 * entité, qui serait faux, et propose de relire. Ni 0 ni liste vide : on ne sait pas.
 */
export function EntitiesUnavailable({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('common');
  return (
    <div className="flex items-center gap-2 px-[11px] pt-3.5 text-[12.5px] text-muted">
      <span>{t('entitiesUnavailable')}</span>
      <button type="button" onClick={onRetry} className="font-semibold text-accent-ink underline underline-offset-2">
        {t('retry')}
      </button>
    </div>
  );
}
