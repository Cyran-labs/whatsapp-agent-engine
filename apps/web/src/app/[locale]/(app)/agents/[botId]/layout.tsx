'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { NOT_RESPONDING_REASONS, type NotRespondingReason } from '@wabagent/contracts';
import { AgentInfoProvider, ReportBotProvider, type AgentInfo } from '@/components/agent/agent-context';
import { AgentShell } from '@/components/agent/agent-shell';
import type { BotView } from '@/lib/agent-types';
import { UNKNOWN_STATUS } from '@/components/agents/status-pill';
import { apiFetch } from '@/lib/api-fetch';

function unknownInfo(botId: string): AgentInfo {
  return { name: botId, status: UNKNOWN_STATUS, status_reason: null, not_responding: null, account_state: null };
}

/** Ce que la colonne lit de l'agent IA ; un motif de mention inconnu des contrats n'est pas affiché. */
function agentInfoOf(bot: BotView): AgentInfo {
  const raw: unknown = bot.not_responding;
  const notResponding = typeof raw === 'string' && (NOT_RESPONDING_REASONS as readonly string[]).includes(raw) ? (raw as NotRespondingReason) : null;
  return {
    name: bot.name,
    status: bot.status,
    status_reason: typeof bot.status_reason === 'string' ? bot.status_reason : null,
    not_responding: notResponding,
    account_state: bot.whatsapp_number?.account?.state ?? null,
  };
}

export default function AgentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ botId: string }>;
}) {
  const { botId } = use(params);
  // Nul pendant le chargement (squelettes dans le rail). Lecture en échec : l'identifiant tient lieu de nom et le statut
  // est dit inconnu, jamais un « Draft » inventé, ni mention ni motif (audit R-23).
  const [info, setInfo] = useState<AgentInfo | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch(`/api/bots/${encodeURIComponent(botId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Partial<BotView> | null) => {
        if (!alive) return;
        if (typeof b?.name === 'string' && typeof b.status === 'string') setInfo(agentInfoOf(b as BotView));
        else setInfo(unknownInfo(botId));
      })
      .catch(() => {
        if (alive) setInfo(unknownInfo(botId));
      });
    return () => {
      alive = false;
    };
  }, [botId]);

  // La page relit l'agent IA après un changement : le rail suit sans attendre un rechargement.
  const report = useCallback((bot: BotView) => setInfo(agentInfoOf(bot)), []);

  // Le fil d'Ariane de chaque page nomme l'agent IA de la même lecture que la colonne.
  return (
    <AgentShell botId={botId} agent={info}>
      <AgentInfoProvider value={info}>
        <ReportBotProvider value={report}>{children}</ReportBotProvider>
      </AgentInfoProvider>
    </AgentShell>
  );
}
