'use client';
import { useTranslations } from 'next-intl';
import { useSession } from '@/components/providers/session-provider';
import { AgentStatusLine } from '@/components/agents/agent-status-line';
import { MiddleColumn, type ColumnGroup, type ColumnItem } from '@/components/shell/middle-column';
import { Skeleton } from '@/components/ui/skeleton';
import type { AgentInfo } from './agent-context';
import { AGENT_SECTIONS } from './agent-sections';

/**
 * Colonne du milieu de l'agent IA (spec 10.3) : bloc Organisation, « ‹ Tous les agents IA », étiquette « Agent IA »,
 * nom, pastille avec le motif d'Offline ou la mention « Ne répond pas » (spec 7.3, point 4), ligne « Entité · {nom} »,
 * sections de l'agent IA.
 */
export function AgentRail({
  botId,
  activeKey,
  agent,
}: {
  botId: string;
  activeKey: string;
  /** Nul pendant le chargement de l'agent IA : nom et statut en squelette. */
  agent: AgentInfo | null;
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
      // prototype 8 : le lien change d'espace et le dit (A-7)
      items: [{ key: 'organisation-numbers', label: t('organisationNumbers'), icon: '⇄', href: '/organisation/connexions', external: t('connectionsSpace') }],
    });
  }
  return (
    <MiddleColumn
      back={{ label: t('allAgents'), href: '/' }}
      kicker={t('kicker')}
      title={agent?.name ?? <Skeleton className="h-5 w-32" />}
      header={
        agent === null ? (
          <Skeleton className="h-[22px] w-16 rounded-full" />
        ) : (
          <>
            <AgentStatusLine status={agent.status} statusReason={agent.status_reason} notResponding={agent.not_responding} accountState={agent.account_state} />
            {/* prototype 7 : l'entité de l'agent IA, absente tant qu'elle n'est pas lue ou si la lecture échoue */}
            {agent.entity_name !== null && (
              <div title={agent.entity_name} className="mt-1.5 truncate text-[12px] text-muted-2">{t('entityLine', { name: agent.entity_name })}</div>
            )}
          </>
        )
      }
      groups={groups}
      activeKey={activeKey}
    />
  );
}
