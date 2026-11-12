'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type Period = 7 | 30 | 90;

const PERIODS: Period[] = [7, 30, 90];

/**
 * Choix de la période d'une page d'usage (spec 10.4, 10.8) : action principale de la barre du haut, un groupe de
 * trois boutons. La période vit dans la page (choix P-7), qui la passe ici et à sa lecture.
 */
export function PeriodChoice({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const t = useTranslations('usage');
  return (
    <div role="group" aria-label={t('periodLabel')} className="flex overflow-hidden rounded-md border border-border-strong">
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={p === value}
          onClick={() => onChange(p)}
          className={cn(
            'px-3.5 py-1.5 text-[13px]',
            p === value ? 'bg-brand-deep font-semibold text-brand-on' : 'bg-surface text-muted hover:bg-surface-subtle',
          )}
        >
          {t(`p${p}` as const)}
        </button>
      ))}
    </div>
  );
}
