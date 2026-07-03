'use client';
import { usePathname } from '@/i18n/routing';
import { AgentRail } from './agent-rail';

export function AgentShell({
  botId,
  agentName,
  status,
  children,
}: {
  botId: string;
  agentName: string;
  status: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const activeKey = path.endsWith('/usage') ? 'usage' : 'overview';
  return (
    <div className="flex flex-1 overflow-hidden">
      <AgentRail botId={botId} activeKey={activeKey} agentName={agentName} status={status} />
      <div className="flex-1 overflow-auto px-8 py-7">{children}</div>
    </div>
  );
}
