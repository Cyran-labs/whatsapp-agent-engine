'use client';
import { use, useEffect, useState } from 'react';
import { TopBar } from '@/components/shell/top-bar';
import { AgentShell } from '@/components/agent/agent-shell';

export default function AgentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ botId: string }>;
}) {
  const { botId } = use(params);
  const [info, setInfo] = useState<{ name: string; status: string }>({ name: '', status: 'draft' });

  useEffect(() => {
    let alive = true;
    fetch(`/api/bots/${botId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (alive && b) setInfo({ name: b.name ?? '', status: b.status ?? 'draft' });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [botId]);

  return (
    <div className="flex h-screen flex-col bg-bg">
      <TopBar active="agents" crumb={info.name} />
      <AgentShell botId={botId} agentName={info.name} status={info.status}>
        {children}
      </AgentShell>
    </div>
  );
}
