'use client';
import { useTranslations } from 'next-intl';
import { useSession } from '@/components/providers/session-provider';
import { AgentStatusLine } from '@/components/agents/agent-status-line';
import { MiddleColumn, type ColumnItem } from '@/components/shell/middle-column';
import { GuardedLink } from '@/components/shell/navigation-guard';
import { Skeleton } from '@/components/ui/skeleton';
import type { AgentInfo } from './agent-context';
import { AGENT_SECTIONS } from './agent-sections';

/**
 * Colonne du milieu de l'agent IA (spec 10.3) : bloc Organisation, « ‹ Tous les agents IA », étiquette « Agent IA »,
 * nom, pastille avec le motif d'Offline ou la mention « Ne répond pas » (spec 7.3, point 4), ligne « Entité · {nom} »,
 * sections de l'agent IA, et pour l'administrateur l'encart des numéros WhatsApp de l'organisation en bas de colonne.
 * Lecture de l'agent IA en échec : « Agent IA indisponible », comme le titre de la page, sans l'identifiant de l'adresse
 * ni pastille « Statut inconnu » (recette phase E, revient sur R-23 ; revue isolation entête M-4).
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
  const tAgents = useTranslations('agents');
  const { isAdmin } = useSession();
  const base = `/agents/${encodeURIComponent(botId)}`;
  // nav 15.5 : « Usage et coûts » n'est rendue que pour l'admin (spec 9.1).
  const items: ColumnItem[] = AGENT_SECTIONS.filter((s) => isAdmin || !s.adminOnly).map((s) => ({
    key: s.key,
    label: t(s.i18n),
    icon: s.icon,
    // Section à venir : grisée, « Soon », sa bulle dit ce qu'elle apportera (spec 5.2).
    ...(s.soon ? { tooltip: t(`soon.${s.key as 'conversations' | 'personality' | 'crm' | 'settings'}`) } : {}),
    href: s.soon || s.href === null ? null : s.href === '' ? base : `${base}/${s.href}`,
  }));
  // recette Q-4 : le chemin vers les numéros WhatsApp de l'organisation, pour l'admin seulement (page réservée à l'admin) ;
  // spec en-tête 2.3 : un encart bordé en bas de colonne, qui se voit ; le lien change d'espace et le dit (« ↗ », A-7).
  const connections = isAdmin ? (
    <div data-column-connections="" className="rounded-lg border border-border bg-surface-subtle px-3 py-2.5">
      <div className="text-[12.5px] font-semibold leading-snug text-fg">{t('organisationNumbers')}</div>
      <GuardedLink href="/organisation/connexions" className="mt-1 inline-block text-[12.5px] font-semibold text-accent-ink hover:underline">
        {t('openConnections')}
      </GuardedLink>
    </div>
  ) : undefined;
  return (
    <MiddleColumn
      back={{ label: t('allAgents'), href: '/' }}
      kicker={t('kicker')}
      title={agent === null ? <Skeleton className="h-5 w-32" /> : agent.unavailable ? tAgents('header.agentUnavailable') : agent.name}
      header={
        agent === null ? (
          <Skeleton className="h-[22px] w-16 rounded-full" />
        ) : agent.unavailable ? undefined : (
          <>
            <AgentStatusLine status={agent.status} statusReason={agent.status_reason} notResponding={agent.not_responding} accountState={agent.account_state} />
            {/* prototype 7 : l'entité de l'agent IA, absente tant qu'elle n'est pas lue ou si la lecture échoue */}
            {agent.entity_name !== null && (
              <div title={agent.entity_name} className="mt-1.5 truncate text-[12px] text-muted-2">{t('entityLine', { name: agent.entity_name })}</div>
            )}
          </>
        )
      }
      groups={[{ items }]}
      activeKey={activeKey}
      footer={connections}
    />
  );
}
