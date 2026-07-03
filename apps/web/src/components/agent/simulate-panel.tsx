'use client';

import { useTranslations } from 'next-intl';
import { SimulateChat } from './simulate-chat';

export function SimulatePanel({ botId, onClose }: { botId: string; onClose: () => void }) {
  const t = useTranslations('overview');
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-deep/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-serif text-base">{t('simulate')}</span>
          <button
            type="button"
            aria-label="Fermer"
            onClick={onClose}
            className="text-muted-2 hover:text-fg"
          >
            ×
          </button>
        </div>
        <div className="p-4">
          <SimulateChat botId={botId} />
        </div>
      </div>
    </div>
  );
}
