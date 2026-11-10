'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { activeEntities, type EntitySummary } from '@/lib/entities';
import type { AgentSummaryRow } from '@/lib/onboarding';
import type { DescribedFailure } from '@/lib/describe-failure';
import { EntitiesTable } from '@/components/organisation/entities-table';
import { ArchiveEntityDialog } from '@/components/organisation/archive-entity-dialog';
import { MoveAgentDialog } from '@/components/organisation/move-agent-dialog';
import { useOrganisationCounts } from '@/components/organisation/organisation-counts';
import { useBusyIds } from '@/components/organisation/use-busy-ids';
import type { RowFailure } from '@/components/organisation/row-error';
import { LoadError } from '@/components/feedback/load-error';
import { StaleBanner } from '@/components/feedback/stale-banner';
import { useNotify } from '@/components/feedback/notification-provider';
import { useMutate } from '@/components/feedback/use-mutate';
import { apiFetch, isOrgChanged } from '@/lib/api-fetch';
import { errorText } from '@/lib/error-text';

type Dialog = { kind: 'archive'; entityId: number } | { kind: 'move'; entityId: number; botId?: string };

export default function EntitesPage() {
  const t = useTranslations('organisation.entities');
  const notify = useNotify();
  const mutate = useMutate('Entities');
  const { refreshCounts } = useOrganisationCounts();
  const [entities, setEntities] = useState<EntitySummary[] | null>(null);
  const [agents, setAgents] = useState<AgentSummaryRow[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [archivedFailed, setArchivedFailed] = useState(false);
  // Relecture en échec après une écriture réussie : le contenu affiché est celui de la dernière lecture.
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<number, RowFailure>>(new Map());
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedLoaded, setArchivedLoaded] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const archivedLoadedRef = useRef(false);
  const reactivating = useBusyIds();

  const fetchEntities = useCallback(async (withArchived: boolean) => {
    const res = await apiFetch(withArchived ? '/api/entities?include_archived=true' : '/api/entities');
    if (await isOrgChanged(res)) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setEntities((await res.json()) as EntitySummary[]);
    if (withArchived) {
      archivedLoadedRef.current = true;
      setArchivedLoaded(true);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    const res = await apiFetch('/api/bots/summary');
    if (await isOrgChanged(res)) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setAgents((await res.json()) as AgentSummaryRow[]);
  }, []);

  /** Relit la liste ; une fois les archivées chargées, on les relit aussi (le compte reste juste). */
  const reloadEntities = useCallback(() => fetchEntities(archivedLoadedRef.current), [fetchEntities]);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchEntities(false), fetchAgents()]).catch((err: unknown) => {
      console.error('[Entities] chargement impossible', errorText(err));
      if (alive) setLoadFailed(true);
    });
    return () => { alive = false; };
  }, [fetchEntities, fetchAgents, attempt]);

  function retryLoad() {
    setLoadFailed(false);
    setAttempt((n) => n + 1);
  }

  const all = entities ?? [];
  const active = activeEntities(all);
  const archived = all.filter((e) => e.status === 'archived');
  const rows = showArchived ? [...active, ...archived] : active;

  const agentsByEntity = useMemo(() => {
    const map = new Map<number, AgentSummaryRow[]>();
    for (const a of agents) map.set(a.entity_id, [...(map.get(a.entity_id) ?? []), a]);
    return map;
  }, [agents]);

  /**
   * Relit après une écriture réussie. Un échec n'en est pas un pour l'action : le bandeau le dit avec Réessayer
   * (audit §5.1), la liste reste celle de la dernière lecture.
   */
  async function reloadAfterWrite(): Promise<void> {
    try {
      await reloadEntities();
    } catch (err) {
      console.error('[Entities] relecture impossible', errorText(err));
      setStale(true);
    }
  }

  /** Seule une relecture complète réussie retire le bandeau (une autre liste a pu rester périmée). */
  async function retryStale() {
    try {
      await Promise.all([reloadEntities(), fetchAgents()]);
      setStale(false);
    } catch (err) {
      console.error('[Entities] relecture impossible', errorText(err));
    }
  }

  async function createEntity(name: string): Promise<DescribedFailure | null> {
    const outcome = await mutate('/api/entities', 'POST', { name }, ['name']);
    if (outcome.status === 'changed') return null;
    if (outcome.status === 'refused') return outcome.failure;
    setCreating(false);
    await reloadAfterWrite();
    refreshCounts();
    return null;
  }

  async function renameEntity(id: number, name: string): Promise<DescribedFailure | null> {
    const outcome = await mutate(`/api/entities/${id}`, 'PATCH', { name }, ['name']);
    if (outcome.status === 'changed') return null;
    if (outcome.status === 'refused') return outcome.failure;
    await reloadAfterWrite();
    return null;
  }

  async function archiveEntity(entity: EntitySummary): Promise<DescribedFailure | null> {
    const outcome = await mutate(`/api/entities/${entity.id}`, 'PATCH', { status: 'archived' });
    if (outcome.status === 'changed') return null;
    if (outcome.status === 'refused') return outcome.failure;
    setDialog(null);
    notify.success(t('archived', { name: entity.name }));
    await reloadAfterWrite();
    refreshCounts();
    return null;
  }

  function dismissRowError(id: number) {
    setRowErrors((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }

  async function reactivateEntity(entity: EntitySummary) {
    if (!reactivating.begin(entity.id)) return;
    dismissRowError(entity.id);
    const outcome = await mutate(`/api/entities/${entity.id}`, 'PATCH', { status: 'active' });
    reactivating.end(entity.id);
    if (outcome.status === 'changed') return;
    if (outcome.status === 'refused') {
      setRowErrors((current) => new Map(current).set(entity.id, { name: entity.name, failure: outcome.failure }));
      // Refus : rien n'a été enregistré, une relecture en échec ne dit donc pas « Modification enregistrée ».
      await reloadEntities().catch((err: unknown) => console.error('[Entities] relecture impossible', errorText(err)));
      return;
    }
    await reloadAfterWrite();
    refreshCounts();
  }

  async function moveAgent(botId: string, entityId: number): Promise<DescribedFailure | null> {
    const outcome = await mutate(`/api/bots/${encodeURIComponent(botId)}`, 'PATCH', { entity_id: entityId });
    if (outcome.status === 'changed') return null;
    if (outcome.status === 'refused') return outcome.failure;
    setDialog(null);
    const botName = agents.find((a) => a.bot_id === botId)?.name ?? '';
    const entityName = all.find((e) => e.id === entityId)?.name ?? '';
    notify.success(t('moved', { bot: botName, entity: entityName }));
    try {
      await fetchAgents();
    } catch (e) {
      console.error('[Entities] relecture des agents IA impossible', errorText(e));
      setStale(true);
    }
    return null;
  }

  function loadArchived() {
    setArchivedFailed(false);
    fetchEntities(true).catch((err: unknown) => {
      console.error('[Entities] chargement des archivées impossible', errorText(err));
      setArchivedFailed(true);
    });
  }

  function toggleArchived(checked: boolean) {
    setShowArchived(checked);
    if (checked && !archivedLoadedRef.current) loadArchived();
  }

  const dialogEntity = dialog ? all.find((e) => e.id === dialog.entityId) : undefined;
  const dialogAgents = dialogEntity ? agentsByEntity.get(dialogEntity.id) ?? [] : [];

  return (
    <>
      <div className="mb-[18px] flex items-start justify-between">
        <div>
          <h1 className="font-serif text-[26px] font-normal leading-[1.1] text-fg">{t('title')}</h1>
          <p className="mt-[5px] max-w-[560px] text-[12.5px] text-muted-2">{t('subtitle')}</p>
        </div>
        <Button type="button" disabled={loadFailed} onClick={() => setCreating(true)} className="h-auto px-[15px] py-2 text-[13px] font-bold">
          {t('new')}
        </Button>
      </div>

      <div className="mb-3 flex items-center justify-between text-[13px] text-muted">
        {entities && !loadFailed ? <span>{t('activeCount', { count: active.length })}</span> : loadFailed ? <span /> : <Skeleton className="h-3.5 w-28" />}
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={showArchived}
            disabled={loadFailed}
            onChange={(e) => toggleArchived(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent-ink)]"
          />
          {archivedLoaded ? t('showArchivedCount', { count: archived.length }) : t('showArchived')}
        </label>
      </div>

      {loadFailed ? (
        <LoadError message={t('loadError')} onRetry={retryLoad} />
      ) : (
        <>
          {stale && <StaleBanner onRetry={() => void retryStale()} />}
          {showArchived && archivedFailed && (
            <div className="mb-3">
              <LoadError message={t('archivedLoadError')} onRetry={loadArchived} />
            </div>
          )}
          <EntitiesTable
            rows={entities ? rows : null}
            agentsByEntity={agentsByEntity}
            activeCount={active.length}
            creating={creating}
            onCancelCreate={() => setCreating(false)}
            onCreate={createEntity}
            onRename={renameEntity}
            onArchive={(e) => setDialog({ kind: 'archive', entityId: e.id })}
            onMove={(e) => setDialog({ kind: 'move', entityId: e.id })}
            onReactivate={(e) => void reactivateEntity(e)}
            busyIds={reactivating.ids}
            rowErrors={rowErrors}
            onDismissError={dismissRowError}
          />
        </>
      )}

      {dialog?.kind === 'archive' && dialogEntity && (
        <ArchiveEntityDialog
          entity={dialogEntity}
          agents={dialogAgents}
          onClose={() => setDialog(null)}
          onMoveAgent={(botId) => setDialog({ kind: 'move', entityId: dialogEntity.id, botId })}
          onConfirm={() => archiveEntity(dialogEntity)}
        />
      )}
      {dialog?.kind === 'move' && dialogEntity && (
        <MoveAgentDialog
          source={dialogEntity}
          agents={dialogAgents}
          targets={active.filter((e) => e.id !== dialogEntity.id)}
          {...(dialog.botId ? { initialBotId: dialog.botId } : {})}
          onClose={() => setDialog(null)}
          onSubmit={moveAgent}
        />
      )}
    </>
  );
}
