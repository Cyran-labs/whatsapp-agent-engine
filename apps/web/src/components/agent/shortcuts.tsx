'use client';
import { useTranslations } from 'next-intl';
import { ComingSoon } from '@/components/shell/coming-soon';

/**
 * Raccourcis de la Vue d'ensemble. « Tester dans le simulateur » est retiré : « ▶ Simuler » est l'action principale de
 * la barre du haut (prototype 9). « Modifier la personnalité » est à venir (spec 5.4) : grisé, « Soon », bulle.
 */
export function Shortcuts() {
  const t = useTranslations('overview');
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <h3 className="mb-3.5 font-serif text-base font-normal">{t('shortcutsTitle')}</h3>
      <ComingSoon
        tooltip={t('editPersonalitySoon')}
        badge
        className="flex items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 py-2 text-left text-[13px] text-muted-2"
      >
        <span aria-hidden="true">✦</span>
        <span>{t('editPersonality')}</span>
      </ComingSoon>
    </div>
  );
}
