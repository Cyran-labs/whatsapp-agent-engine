'use client';
import { useTranslations } from 'next-intl';
import { useSession } from '@/components/providers/session-provider';
import { StatusPill } from '@/components/agents/status-pill';
import { Rail, type RailGroup, type RailItem } from '@/components/shell/rail';
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
  const { isAdmin } = useSession();
  const items: RailItem[] = AGENT_SECTIONS.map((s) => ({
    key: s.key,
    label: t(s.i18n),
    icon: s.icon,
    soon: s.soon,
    href: s.soon || s.href === null ? null : s.href === '' ? `/agents/${encodeURIComponent(botId)}` : `/agents/${encodeURIComponent(botId)}/${s.href}`,
  }));
  // recette Q-4 : le chemin vers les numéros WhatsApp de l'organisation, pour l'admin seulement (page réservée à l'admin).
  const groups: RailGroup[] = [{ items }];
  if (isAdmin) {
    groups.push({
      label: t('organisation'),
      items: [{ key: 'organisation-numbers', label: t('organisationNumbers'), icon: '⇄', href: '/organisation/connexions' }],
    });
  }
  return (
    <Rail
      title={agentName ?? <Skeleton className="h-5 w-32" />}
      header={status === null ? <Skeleton className="h-[22px] w-16 rounded-full" /> : <StatusPill status={status} />}
      groups={groups}
      activeKey={activeKey}
    />
  );
}
