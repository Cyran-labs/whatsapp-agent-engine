'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { TopBar } from '@/components/shell/top-bar';
import { ReportBotProvider } from '@/components/agent/agent-context';
import { AgentShell } from '@/components/agent/agent-shell';
import type { BotView } from '@/lib/agent-types';
import { apiFetch } from '@/lib/api-fetch';

export default function AgentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ botId: string }>;
}) {
  const { botId } = use(params);
  // Nul pendant le chargement (squelettes dans le rail) ; en cas d'échec, nom vide et brouillon comme avant.
  const [info, setInfo] = useState<{ name: string; status: string } | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch(`/api/bots/${encodeURIComponent(botId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (alive) setInfo({ name: b?.name ?? '', status: b?.status ?? 'draft' });
      })
      .catch(() => {
        if (alive) setInfo({ name: '', status: 'draft' });
      });
    return () => {
      alive = false;
    };
  }, [botId]);

  // La page relit l'agent IA après un changement : le rail suit sans attendre un rechargement.
  const report = useCallback((bot: BotView) => setInfo({ name: bot.name, status: bot.status }), []);

  return (
    <div className="flex h-screen flex-col bg-bg">
      <TopBar active="agents" crumb={info?.name ?? ''} />
      <AgentShell botId={botId} agentName={info?.name ?? null} status={info?.status ?? null}>
        <ReportBotProvider value={report}>{children}</ReportBotProvider>
      </AgentShell>
    </div>
  );
}
