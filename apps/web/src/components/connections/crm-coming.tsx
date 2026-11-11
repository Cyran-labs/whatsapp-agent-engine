'use client';

import { useTranslations } from 'next-intl';
import { ComingSoon } from '@/components/shell/coming-soon';

/**
 * Section CRM à venir (spec 5.4) : grisée, pastille « Soon », bulle « Disponible prochainement : … » au survol et au
 * focus. Le raccordement des CRM arrivera au même endroit ; aujourd'hui sans effet, et elle le dit.
 */
export function CrmComing() {
  const t = useTranslations('connections.crm');
  return (
    <ComingSoon
      role="group"
      label={t('title')}
      tooltip={t('soon')}
      badge
      className="flex items-center gap-3.5 rounded-xl border border-dashed border-border-strong bg-surface px-[18px] py-4 text-[13px] text-muted-2"
    >
      <h3 className="font-serif text-[17px] font-normal text-muted">{t('title')}</h3>
      <span>{t('text')}</span>
    </ComingSoon>
  );
}
