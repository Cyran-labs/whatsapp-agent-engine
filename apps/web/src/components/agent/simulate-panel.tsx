'use client';

import { useTranslations } from 'next-intl';
import { SimulateChat } from './simulate-chat';

export function SimulatePanel({ botId, agentName, onClose }: { botId: string; agentName: string; onClose: () => void }) {
  const t = useTranslations('overview');
  const ts = useTranslations('simulate');
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
          <h2 className="min-w-0 truncate font-serif text-base font-normal" title={t('simulate', { name: agentName })}>{t('simulate', { name: agentName })}</h2>
          <button
            type="button"
            aria-label={ts('close')}
            onClick={onClose}
            className="text-muted-2 hover:text-fg"
          >
            ×
          </button>
        </div>
        <div className="p-4">
          <SimulateChat botId={botId} agentName={agentName} />
        </div>
      </div>
    </div>
  );
}
