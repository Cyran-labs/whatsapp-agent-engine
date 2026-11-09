'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '@/components/providers/session-provider';
import { HealthPanel } from './health-panel';
import { RecentConversations, type RecentRow } from './recent-conversations';
import { CostCard } from './cost-card';
import { Shortcuts } from './shortcuts';
import { SimulatePanel } from './simulate-panel';
import { AllowlistPanel } from './allowlist-panel';
import { NumberPanel } from './number-panel';
import { PanelSkeleton } from './panel-ui';
import { StatusPanel } from './status-panel';
import type { BotHealth, BotMetrics, BotView, UsageData } from '@/lib/agent-types';
import { Skeleton } from '@/components/ui/skeleton';

export interface OverviewData {
  bot: BotView;
  health: BotHealth;
  metrics: BotMetrics;
  usage: UsageData;
  recent: RecentRow[];
}

interface Props {
  /** Nul : chargement en cours, panneaux affichés avec leurs titres et leurs valeurs en squelette. */
  data: OverviewData | null;
  botId: string;
  /** Relecture de la page après un changement de numéro, de statut ou de liste d'accès limité. */
  onChanged: () => void;
}

export function Overview({ data, botId, onChanged }: Props) {
  const t = useTranslations('overview');
  const tn = useTranslations('agentNumber');
  const ts = useTranslations('agentStatus');
  const ta = useTranslations('agentAllowlist');
  const { isAdmin, readOnly } = useSession();
  const [simOpen, setSimOpen] = useState(false);
  // Les actions sont réservées à l'admin hors lecture seule ; le numéro en entier, à l'admin.
  const canEdit = isAdmin && !readOnly;
  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-5 flex items-start justify-between">
        <div>
          {/* Nom de l'agent géré par le rail latéral (pas de duplication ici) */}
          {data ? (
            <div className="mt-1.5 text-[12.5px] text-muted-2">
              {data.health.languages.map((l) => l.toUpperCase()).join(' · ')}
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
        </div>
      </div>
      <div className="grid grid-cols-[1.7fr_1fr] gap-4">
        <div>
          <HealthPanel health={data?.health ?? null} metrics={data?.metrics ?? null} />
          {data ? <StatusPanel bot={data.bot} canEdit={canEdit} onChanged={onChanged} /> : <PanelSkeleton title={ts('title')} />}
          {data ? <AllowlistPanel botId={botId} entries={data.bot.allowlist} canEdit={canEdit} onChanged={onChanged} /> : <PanelSkeleton title={ta('title')} />}
          <RecentConversations rows={data?.recent ?? null} />
        </div>
        <div>
          <CostCard usage={data?.usage ?? null} />
          {data ? <NumberPanel bot={data.bot} canEdit={canEdit} seeFull={isAdmin} onChanged={onChanged} /> : <PanelSkeleton title={tn('title')} />}
          <Shortcuts onSimulate={readOnly ? undefined : () => setSimOpen(true)} />
        </div>
      </div>
      {simOpen && !readOnly && <SimulatePanel botId={botId} onClose={() => setSimOpen(false)} />}
    </div>
  );
}
