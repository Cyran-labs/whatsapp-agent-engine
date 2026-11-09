'use client';

import { useTranslations } from 'next-intl';

/** Bloc « CRM : à venir » : le raccordement des CRM arrivera au même endroit, sans effet aujourd'hui. */
export function CrmComing() {
  const t = useTranslations('connections.crm');
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-dashed border-border-strong bg-surface px-[18px] py-4 text-[13px] text-muted-2">
      <h3 className="font-serif text-[17px] font-normal text-muted">{t('title')}</h3>
      <span>{t('text')}</span>
      <span className="ml-auto whitespace-nowrap rounded-pill border border-border bg-surface-subtle px-[9px] py-0.5 text-[11px] font-semibold text-muted-2">
        {t('soon')}
      </span>
    </div>
  );
}
