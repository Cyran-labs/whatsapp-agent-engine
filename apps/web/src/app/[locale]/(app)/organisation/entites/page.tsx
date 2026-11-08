'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { activeEntities, type EntitySummary } from '@/lib/entities';
import type { AgentSummaryRow } from '@/lib/onboarding';
import { EntitiesTable } from '@/components/organisation/entities-table';
import { ArchiveEntityDialog } from '@/components/organisation/archive-entity-dialog';
import { MoveAgentDialog } from '@/components/organisation/move-agent-dialog';
import { useOrganisationCounts } from '@/components/organisation/organisation-counts';
import { apiFetch, sendMutation } from '@/lib/api-fetch';

type Dialog = { kind: 'archive'; entityId: number } | { kind: 'move'; entityId: number; botId?: string };

export default function EntitesPage() {
  const t = useTranslations('organisation.entities');
  const tc = useTranslations('common');
  const { refreshCounts } = useOrganisationCounts();
  const [entities, setEntities] = useState<EntitySummary[] | null>(null);
  const [agents, setAgents] = useState<AgentSummaryRow[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedLoaded, setArchivedLoaded] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const archivedLoadedRef = useRef(false);

  const fetchEntities = useCallback(async (withArchived: boolean) => {
    const res = await apiFetch(withArchived ? '/api/entities?include_archived=true' : '/api/entities');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setEntities((await res.json()) as EntitySummary[]);
    if (withArchived) {
      archivedLoadedRef.current = true;
      setArchivedLoaded(true);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    const res = await apiFetch('/api/bots/summary');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setAgents((await res.json()) as AgentSummaryRow[]);
  }, []);

  /** Relit la liste ; une fois les archivées chargées, on les relit aussi (le compte reste juste). */
  const reloadEntities = useCallback(() => fetchEntities(archivedLoadedRef.current), [fetchEntities]);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchEntities(false), fetchAgents()]).catch((err: unknown) => {
      console.error('[Entities] chargement impossible', err);
      if (alive) setLoadFailed(true);
    });
    return () => { alive = false; };
  }, [fetchEntities, fetchAgents]);

  const all = entities ?? [];
  const active = activeEntities(all);
  const archived = all.filter((e) => e.status === 'archived');
  const rows = showArchived ? [...active, ...archived] : active;

  const agentsByEntity = useMemo(() => {
    const map = new Map<number, AgentSummaryRow[]>();
    for (const a of agents) map.set(a.entity_id, [...(map.get(a.entity_id) ?? []), a]);
    return map;
  }, [agents]);

  /** Envoie une mutation ; renvoie le message d'erreur, ou null en cas de succès. */
  async function send(url: string, method: string, body: unknown): Promise<string | null> {
    const result = await sendMutation(url, method, body, tc('error'), 'Entities');
    return 'error' in result ? result.error : null;
  }

  async function afterEntityChange() {
    try {
      await reloadEntities();
    } catch (err) {
      console.error('[Entities] relecture impossible', err);
    }
    refreshCounts();
  }

  async function createEntity(name: string): Promise<string | null> {
    setActionError(null);
    const err = await send('/api/entities', 'POST', { name });
    if (err) return err;
    setCreating(false);
    await afterEntityChange();
    return null;
  }

  async function renameEntity(id: number, name: string): Promise<string | null> {
    setActionError(null);
    const err = await send(`/api/entities/${id}`, 'PATCH', { name });
    if (err) return err;
    await reloadEntities().catch((e: unknown) => console.error('[Entities] relecture impossible', e));
    return null;
  }

  async function archiveEntity(entity: EntitySummary): Promise<string | null> {
    const err = await send(`/api/entities/${entity.id}`, 'PATCH', { status: 'archived' });
    if (err) return err;
    setDialog(null);
    await afterEntityChange();
    return null;
  }

  async function reactivateEntity(entity: EntitySummary) {
    setActionError(null);
    const err = await send(`/api/entities/${entity.id}`, 'PATCH', { status: 'active' });
    if (err) {
      setActionError(err);
      return;
    }
    await afterEntityChange();
  }

  async function moveAgent(botId: string, entityId: number): Promise<string | null> {
    const err = await send(`/api/bots/${encodeURIComponent(botId)}`, 'PATCH', { entity_id: entityId });
    if (err) return err;
    setDialog(null);
    await fetchAgents().catch((e: unknown) => console.error('[Entities] relecture des agents IA impossible', e));
    return null;
  }

  function toggleArchived(checked: boolean) {
    setShowArchived(checked);
    if (checked && !archivedLoadedRef.current) {
      fetchEntities(true).catch((err: unknown) => {
        console.error('[Entities] chargement des archivées impossible', err);
        setActionError(tc('error'));
      });
    }
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
        <Button type="button" onClick={() => setCreating(true)} className="h-auto px-[15px] py-2 text-[13px] font-bold">
          {t('new')}
        </Button>
      </div>

      <div className="mb-3 flex items-center justify-between text-[13px] text-muted">
        {entities ? <span>{t('activeCount', { count: active.length })}</span> : loadFailed ? <span /> : <Skeleton className="h-3.5 w-28" />}
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => toggleArchived(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent-ink)]"
          />
          {archivedLoaded ? t('showArchivedCount', { count: archived.length }) : t('showArchived')}
        </label>
      </div>

      {(loadFailed || actionError) && (
        <p role="alert" className="mb-3 text-[12.5px] text-danger">{loadFailed ? t('loadError') : actionError}</p>
      )}

      {(entities || !loadFailed) && (
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
        />
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
