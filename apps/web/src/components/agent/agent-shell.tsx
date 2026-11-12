'use client';
import { usePathname } from '@/i18n/routing';
import { AppFrame } from '@/components/shell/app-frame';
import type { AgentInfo } from './agent-context';
import { AgentRail } from './agent-rail';
import { isAgentUsagePath } from './agent-path';

/**
 * Cadre des pages d'un agent IA : rail (Agents IA actif, usage compris, spec 5.1), colonne de l'agent IA, puis la
 * page, qui pose sa barre du haut.
 */
export function AgentShell({
  botId,
  agent,
  children,
}: {
  botId: string;
  /** Nul pendant la lecture de l'agent IA. */
  agent: AgentInfo | null;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const activeKey = isAgentUsagePath(path, botId) ? 'usage' : 'overview';
  return (
    <AppFrame space="agents" column={<AgentRail botId={botId} activeKey={activeKey} agent={agent} />}>
      {children}
    </AppFrame>
  );
}
