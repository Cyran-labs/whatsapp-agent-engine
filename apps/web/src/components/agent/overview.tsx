'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '@/components/providers/session-provider';
import { HealthPanel } from './health-panel';
import { RecentConversations, type RecentRow } from './recent-conversations';
import { CostCard } from './cost-card';
import { Shortcuts } from './shortcuts';
import { SimulatePanel } from './simulate-panel';
import type { BotHealth, BotMetrics, UsageData } from '@/lib/agent-types';
import { Skeleton } from '@/components/ui/skeleton';

export interface OverviewData {
  health: BotHealth;
  metrics: BotMetrics;
  usage: UsageData;
  recent: RecentRow[];
}

/** `data` nul : chargement en cours, panneaux affichés avec leurs titres et leurs valeurs en squelette. */
export function Overview({ data, botId }: { data: OverviewData | null; botId: string }) {
  const t = useTranslations('overview');
  const { isAdmin, readOnly } = useSession();
  const [simOpen, setSimOpen] = useState(false);
  const num = data?.health.numbers[0] ?? '';
  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-5 flex items-start justify-between">
        <div>
          {/* Nom de l'agent géré par le rail latéral (pas de duplication ici) */}
          {data ? (
            <div className="mt-1.5 text-[12.5px] text-muted-2">
              {[num && num, data.health.languages.map((l) => l.toUpperCase()).join(' · ')].filter(Boolean).join(' · ')}
            </div>
          ) : (
            <Skeleton className="mt-2 h-3 w-40" />
          )}
        </div>
        <div className="flex gap-2">
          {!readOnly && (
            <button
              type="button"
              onClick={() => setSimOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 py-2 text-[13px] hover:bg-surface-subtle"
            >
              ▶ {t('simulateAction')}
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              disabled
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 py-2 text-[13px] opacity-50"
            >
              ⏸ {t('pauseAction')}
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-[1.7fr_1fr] gap-4">
        <div>
          <HealthPanel health={data?.health ?? null} metrics={data?.metrics ?? null} />
          <RecentConversations rows={data?.recent ?? null} />
        </div>
        <div>
          <CostCard usage={data?.usage ?? null} />
          <Shortcuts onSimulate={readOnly ? undefined : () => setSimOpen(true)} />
        </div>
      </div>
      {simOpen && !readOnly && <SimulatePanel botId={botId} onClose={() => setSimOpen(false)} />}
    </div>
  );
}
