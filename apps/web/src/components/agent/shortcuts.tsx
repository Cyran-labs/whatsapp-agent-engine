'use client';
import { useId } from 'react';
import { useTranslations } from 'next-intl';

export function Shortcuts({ onSimulate }: { onSimulate?: () => void }) {
  const t = useTranslations('overview');
  const soonId = useId();
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <h3 className="mb-3.5 font-serif text-base font-normal">{t('shortcutsTitle')}</h3>
      <div className="flex flex-col gap-2">
        {onSimulate && (
          <button
            type="button"
            onClick={onSimulate}
            className="flex items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 py-2 text-left text-[13px] hover:bg-surface-subtle"
          >
            💬 {t('simulate')}
          </button>
        )}
        <button
          type="button"
          disabled
          aria-describedby={soonId}
          className="flex cursor-not-allowed items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 py-2 text-left text-[13px] opacity-50"
        >
          ✦ {t('editPersonality')}
        </button>
        <p id={soonId} className="text-[12px] text-muted-2">{t('editPersonalitySoon')}</p>
      </div>
    </div>
  );
}
