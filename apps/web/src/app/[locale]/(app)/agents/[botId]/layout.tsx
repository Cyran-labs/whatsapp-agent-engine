'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { AgentInfoProvider, ReportBotProvider } from '@/components/agent/agent-context';
import { AgentShell } from '@/components/agent/agent-shell';
import type { BotView } from '@/lib/agent-types';
import { UNKNOWN_STATUS } from '@/components/agents/status-pill';
import { apiFetch } from '@/lib/api-fetch';

export default function AgentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ botId: string }>;
}) {
  const { botId } = use(params);
  // Nul pendant le chargement (squelettes dans le rail). Lecture en échec : l'identifiant tient lieu de nom et le statut
  // est dit inconnu, jamais un « Brouillon » inventé (audit R-23).
  const [info, setInfo] = useState<{ name: string; status: string } | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch(`/api/bots/${encodeURIComponent(botId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Partial<BotView> | null) => {
        if (!alive) return;
        if (typeof b?.name === 'string' && typeof b.status === 'string') setInfo({ name: b.name, status: b.status });
        else setInfo({ name: botId, status: UNKNOWN_STATUS });
      })
      .catch(() => {
        if (alive) setInfo({ name: botId, status: UNKNOWN_STATUS });
      });
    return () => {
      alive = false;
    };
  }, [botId]);

  // La page relit l'agent IA après un changement : le rail suit sans attendre un rechargement.
  const report = useCallback((bot: BotView) => setInfo({ name: bot.name, status: bot.status }), []);

  // Le fil d'Ariane de chaque page nomme l'agent IA de la même lecture que la colonne.
  return (
    <AgentShell botId={botId} agentName={info?.name ?? null} status={info?.status ?? null}>
      <AgentInfoProvider value={info}>
        <ReportBotProvider value={report}>{children}</ReportBotProvider>
      </AgentInfoProvider>
    </AgentShell>
  );
}
