'use client';
import { usePathname } from '@/i18n/routing';
import { PageShell } from '@/components/shell/page-shell';
import { AgentRail } from './agent-rail';

export function AgentShell({
  botId,
  agentName,
  status,
  children,
}: {
  botId: string;
  agentName: string | null;
  status: string | null;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const activeKey = path.endsWith('/usage') ? 'usage' : 'overview';
  return (
    <PageShell rail={<AgentRail botId={botId} activeKey={activeKey} agentName={agentName} status={status} />}>
      {children}
    </PageShell>
  );
}
