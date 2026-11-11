'use client';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { AgentInfoProvider, ReportBotProvider, type AgentInfo, type EntityReadState } from '@/components/agent/agent-context';
import { AgentShell } from '@/components/agent/agent-shell';
import { isAgentUsagePath } from '@/components/agent/agent-path';
import { ReservedPage } from '@/components/shell/reserved-page';
import { useSession } from '@/components/providers/session-provider';
import { usePathname } from '@/i18n/routing';
import type { BotView } from '@/lib/agent-types';
import { UNKNOWN_STATUS } from '@/components/agents/status-pill';
import { apiFetch } from '@/lib/api-fetch';
import { errorText } from '@/lib/error-text';

/** Ce que la colonne lit de l'agent IA, avant le nom de son entité ; `entity_id` nul : sans entité, ou lecture en échec. */
type AgentRead = Omit<AgentInfo, 'entity_name' | 'entities'>;

function unknownInfo(botId: string): AgentRead {
  return { unavailable: true, name: botId, status: UNKNOWN_STATUS, status_reason: null, not_responding: null, account_state: null, entity_id: null };
}

/** Ce que la colonne lit de l'agent IA ; un motif de mention inconnu des contrats est écarté par `AgentStatusLine`. */
function agentReadOf(bot: BotView): AgentRead {
  const raw: unknown = bot.not_responding;
  return {
    unavailable: false,
    name: bot.name,
    status: bot.status,
    status_reason: typeof bot.status_reason === 'string' ? bot.status_reason : null,
    not_responding: typeof raw === 'string' ? raw : null,
    account_state: bot.whatsapp_number?.account?.state ?? null,
    entity_id: typeof bot.entity_id === 'number' ? bot.entity_id : null,
  };
}

/** Noms des entités par identifiant, lus d'une réponse de `/api/entities` ; null si elle est illisible. */
function entityNamesOf(body: unknown): Map<number, string> | null {
  if (!Array.isArray(body)) return null;
  const names = new Map<number, string>();
  for (const entity of body as Array<{ id?: unknown; name?: unknown }>) {
    if (typeof entity?.id === 'number' && typeof entity.name === 'string') names.set(entity.id, entity.name);
  }
  return names;
}

export default function AgentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ botId: string }>;
}) {
  const { botId } = use(params);
  const { isAdmin } = useSession();
  const path = usePathname();
  // prototype 5, nav 15.5 : l'usage d'un agent IA est réservé à l'admin (spec 9.1, 10.4). Un autre membre voit le refus
  // sur place (spec 10.6) à la même adresse ; ni la page, ni ses lectures, ni son choix de période ne sont rendus.
  if (!isAdmin && isAgentUsagePath(path, botId)) return <ReservedPage />;
  return <AgentLayoutContent botId={botId}>{children}</AgentLayoutContent>;
}

function AgentLayoutContent({ botId, children }: { botId: string; children: React.ReactNode }) {
  // Nul pendant le chargement (squelettes dans le rail). Lecture en échec : l'identifiant tient lieu de nom et le statut
  // est dit inconnu, jamais un « Draft » inventé, ni mention ni motif ni entité (audit R-23).
  const [read, setRead] = useState<AgentRead | null>(null);
  // Entités de l'organisation : nul tant qu'elles ne sont pas lues, ou si la lecture échoue (pas de ligne Entité) ;
  // l'état de la lecture est explicite (P9), la ligne des parents de chaque page en dépend.
  const [entityNames, setEntityNames] = useState<Map<number, string> | null>(null);
  const [entitiesRead, setEntitiesRead] = useState<EntityReadState>('loading');

  useEffect(() => {
    let alive = true;
    apiFetch(`/api/bots/${encodeURIComponent(botId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Partial<BotView> | null) => {
        if (!alive) return;
        if (typeof b?.name === 'string' && typeof b.status === 'string') setRead(agentReadOf(b as BotView));
        else setRead(unknownInfo(botId));
      })
      .catch(() => {
        if (alive) setRead(unknownInfo(botId));
      });
    return () => {
      alive = false;
    };
  }, [botId]);

  // prototype 7 : la ligne « Entité · {nom} » de la colonne et le titre de la page nomment l'entité de l'agent IA.
  useEffect(() => {
    let alive = true;
    apiFetch('/api/entities')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: unknown) => {
        if (!alive) return;
        const names = entityNamesOf(body);
        setEntityNames(names);
        setEntitiesRead(names === null ? 'failed' : 'ready');
      })
      .catch((err: unknown) => {
        console.error('[Agent] lecture des entités impossible', errorText(err));
        if (alive) setEntitiesRead('failed');
      });
    return () => {
      alive = false;
    };
  }, []);

  // La page relit l'agent IA après un changement : le rail suit sans attendre un rechargement.
  const report = useCallback((bot: BotView) => setRead(agentReadOf(bot)), []);

  const info = useMemo<AgentInfo | null>(() => {
    if (read === null) return null;
    return {
      ...read,
      entity_name: read.entity_id !== null ? (entityNames?.get(read.entity_id) ?? null) : null,
      entities: entitiesRead,
    };
  }, [read, entityNames, entitiesRead]);

  // La ligne des parents et le titre de chaque page nomment l'agent IA de la même lecture que la colonne.
  return (
    <AgentShell botId={botId} agent={info}>
      <AgentInfoProvider value={info}>
        <ReportBotProvider value={report}>{children}</ReportBotProvider>
      </AgentInfoProvider>
    </AgentShell>
  );
}
