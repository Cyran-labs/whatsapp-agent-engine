'use client';
import { useTranslations } from 'next-intl';
import { useSession } from '@/components/providers/session-provider';
import { StatusPill } from '@/components/agents/status-pill';
import { MiddleColumn, type ColumnGroup, type ColumnItem } from '@/components/shell/middle-column';
import { Skeleton } from '@/components/ui/skeleton';
import { AGENT_SECTIONS } from './agent-sections';

/** Colonne du milieu de l'agent IA (spec 10.3) : bloc Organisation, nom, statut, sections de l'agent IA. */
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
  const base = `/agents/${encodeURIComponent(botId)}`;
  const items: ColumnItem[] = AGENT_SECTIONS.map((s) => ({
    key: s.key,
    label: t(s.i18n),
    icon: s.icon,
    // Section à venir : grisée, « Soon », sa bulle dit ce qu'elle apportera (spec 5.2).
    ...(s.soon ? { tooltip: t(`soon.${s.key as 'conversations' | 'personality' | 'crm' | 'settings'}`) } : {}),
    href: s.soon || s.href === null ? null : s.href === '' ? base : `${base}/${s.href}`,
  }));
  // recette Q-4 : le chemin vers les numéros WhatsApp de l'organisation, pour l'admin seulement (page réservée à l'admin).
  const groups: ColumnGroup[] = [{ items }];
  if (isAdmin) {
    groups.push({
      label: t('organisation'),
      items: [{ key: 'organisation-numbers', label: t('organisationNumbers'), icon: '⇄', href: '/organisation/connexions' }],
    });
  }
  return (
    <MiddleColumn
      title={agentName ?? <Skeleton className="h-5 w-32" />}
      header={status === null ? <Skeleton className="h-[22px] w-16 rounded-full" /> : <StatusPill status={status} />}
      groups={groups}
      activeKey={activeKey}
    />
  );
}
