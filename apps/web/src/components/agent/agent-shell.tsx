'use client';
import { usePathname } from '@/i18n/routing';
import { AppFrame } from '@/components/shell/app-frame';
import { AgentRail } from './agent-rail';

/**
 * Cadre des pages d'un agent IA : rail (Agents IA actif, usage compris, spec 5.1), colonne de l'agent IA, puis la
 * page, qui pose sa barre du haut.
 */
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
    <AppFrame space="agents" column={<AgentRail botId={botId} activeKey={activeKey} agentName={agentName} status={status} />}>
      {children}
    </AppFrame>
  );
}
