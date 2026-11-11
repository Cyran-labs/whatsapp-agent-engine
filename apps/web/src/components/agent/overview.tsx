'use client';
import { useTranslations } from 'next-intl';
import { useSession } from '@/components/providers/session-provider';
import { HealthPanel } from './health-panel';
import { RecentConversations, type RecentRow } from './recent-conversations';
import { CostCard } from './cost-card';
import { Shortcuts } from './shortcuts';
import { AllowlistPanel } from './allowlist-panel';
import { NumberPanel } from './number-panel';
import { FAILED, PanelSkeleton, type Failed } from './panel-ui';
import { StatusPanel } from './status-panel';
import type { BotHealth, BotMetrics, BotView, UsageData } from '@/lib/agent-types';
import { Skeleton } from '@/components/ui/skeleton';
import type { RetryState } from '@/components/feedback/load-error';

/** Panneaux de la page dont la lecture se refait seule (« Réessayer » d'un panneau en échec, audit R-17). */
export type PanelKey = 'health' | 'metrics' | 'usage' | 'recent';

/**
 * Coûts non lus : réservés à l'admin (spec refonte de la navigation, 9.1), ils ne sont pas demandés pour un autre
 * membre. Distinct du chargement (`data` nul) et de l'échec (`FAILED`) : `CostCard` n'accepte pas cet état.
 */
export const NOT_READ = 'not_read' as const;
export type NotRead = typeof NOT_READ;

/** L'agent IA est lu pour de bon ; chaque autre panneau porte sa lecture ou `FAILED` si elle a échoué. */
export interface OverviewData {
  bot: BotView;
  health: BotHealth | Failed;
  metrics: BotMetrics | Failed;
  usage: UsageData | Failed | NotRead;
  recent: RecentRow[] | Failed;
}

interface Props {
  /** Nul : chargement en cours, panneaux affichés avec leurs titres et leurs valeurs en squelette. */
  data: OverviewData | null;
  botId: string;
  /** Relecture de la page après un changement de numéro, de statut ou de liste d'accès limité qui a réussi. */
  onChanged: () => void;
  /** Relecture après un refus du moteur qui laisse craindre un état périmé : rien n'a été enregistré. */
  onStale: () => void;
  /** Relit un seul panneau dont la lecture a échoué. */
  onRetryPanel: (panel: PanelKey) => void;
  /** Réessai en cours ou en échec de chaque panneau ; absent : aucun réessai en cours. */
  retryStates?: Record<PanelKey, RetryState>;
  /** Nom de l'entité de l'agent IA (lu par la mise en page) ; nul tant qu'il n'est pas lu ou en échec : pas de ligne Entité. */
  entityName: string | null;
}

export function Overview({ data, botId, onChanged, onStale, onRetryPanel, retryStates, entityName }: Props) {
  const tn = useTranslations('agentNumber');
  const tsp = useTranslations('agentSpace');
  const ts = useTranslations('agentStatus');
  const ta = useTranslations('agentAllowlist');
  const { isAdmin, readOnly } = useSession();
  // Les actions sont réservées à l'admin hors lecture seule ; le numéro de l'agent IA est entier pour tous (spec 8).
  const canEdit = isAdmin && !readOnly;
  // Nul : chargement en cours.
  const usage = data ? data.usage : null;
  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-5">
        {/* prototype 7 : le nom de l'agent IA en titre, dessous son entité et ses langues ; « ▶ Simuler » dans la barre du haut. */}
        {data ? (
          <>
            <h1 className="font-serif text-[26px] font-normal leading-tight text-fg">{data.bot.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-2">
              {entityName !== null && <span>{tsp('entityLine', { name: entityName })}</span>}
              {entityName !== null && data.health !== FAILED && <span aria-hidden="true">·</span>}
              {data.health !== FAILED && <span>{data.health.languages.map((l) => l.toUpperCase()).join(' · ')}</span>}
            </div>
          </>
        ) : (
          <>
            <Skeleton className="h-7 w-56" />
            <Skeleton className="mt-2 h-3 w-40" />
          </>
        )}
      </div>
      <div className="grid grid-cols-[1.7fr_1fr] gap-4">
        <div>
          <HealthPanel
            health={data ? data.health : null}
            metrics={data ? data.metrics : null}
            onRetryHealth={() => onRetryPanel('health')}
            onRetryMetrics={() => onRetryPanel('metrics')}
            retryHealth={retryStates?.health}
            retryMetrics={retryStates?.metrics}
          />
          {data ? <StatusPanel bot={data.bot} canEdit={canEdit} onChanged={onChanged} onStale={onStale} /> : <PanelSkeleton title={ts('title')} />}
          {data ? <AllowlistPanel botId={botId} entries={data.bot.allowlist} canEdit={canEdit} onChanged={onChanged} /> : <PanelSkeleton title={ta('title')} />}
          <RecentConversations rows={data ? data.recent : null} onRetry={() => onRetryPanel('recent')} retry={retryStates?.recent} />
        </div>
        <div>
          {/* Coûts réservés à l'admin (spec refonte de la navigation, 9.1) : ni carte ni appel pour un autre membre. */}
          {isAdmin && usage !== NOT_READ && <CostCard usage={usage} onRetry={() => onRetryPanel('usage')} retry={retryStates?.usage} />}
          {data ? <NumberPanel bot={data.bot} canEdit={canEdit} canOpenConnections={isAdmin} onChanged={onChanged} onStale={onStale} /> : <PanelSkeleton title={tn('title')} />}
          <Shortcuts />
        </div>
      </div>
    </div>
  );
}
