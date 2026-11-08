'use client';
import { useTranslations } from 'next-intl';
import { StatusPill } from '@/components/agents/status-pill';
import { Rail, type RailItem } from '@/components/shell/rail';
import { Skeleton } from '@/components/ui/skeleton';
import { AGENT_SECTIONS } from './agent-sections';

export function AgentRail({
  botId,
  activeKey,
  agentName,
  status,
}: {
  botId: string;
  activeKey: string;
  /** Nuls pendant le chargement de l'agent IA : nom et statut en squelette. */
  agentName: string | null;
  status: string | null;
}) {
  const t = useTranslations('agentSpace');
  const items: RailItem[] = AGENT_SECTIONS.map((s) => ({
    key: s.key,
    label: t(s.i18n),
    icon: s.icon,
    soon: s.soon,
    href: s.soon || s.href === null ? null : s.href === '' ? `/agents/${botId}` : `/agents/${botId}/${s.href}`,
  }));
  return (
    <Rail
      title={agentName ?? <Skeleton className="h-5 w-32" />}
      header={status === null ? <Skeleton className="h-[22px] w-16 rounded-full" /> : <StatusPill status={status} />}
      groups={[{ items }]}
      activeKey={activeKey}
    />
  );
}
