'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { EntitySummary } from '@/lib/entities';
import type { AgentSummaryRow } from '@/lib/onboarding';
import { SkeletonRows } from '@/components/ui/skeleton';
import { ActionMenu, type ActionMenuItem } from '@/components/feedback/action-menu';
import type { DescribedFailure } from '@/lib/describe-failure';
import { OrphanRowErrors, RowErrorRow, type RowFailure, type RowFailures } from './row-error';

interface Props {
  /** Nul : chargement en cours, en-tête réel et lignes squelettes. */
  rows: EntitySummary[] | null;
  agentsByEntity: Map<number, AgentSummaryRow[]>;
  /** Nombre d'entités actives de l'organisation (« Archiver » est absent de la dernière). */
  activeCount: number;
  creating: boolean;
  onCancelCreate: () => void;
  /** Les deux envois du nom renvoient le refus à afficher sous le champ, ou null en cas de succès. */
  onCreate: (name: string) => Promise<DescribedFailure | null>;
  onRename: (id: number, name: string) => Promise<DescribedFailure | null>;
  onArchive: (entity: EntitySummary) => void;
  onMove: (entity: EntitySummary) => void;
  onReactivate: (entity: EntitySummary) => void;
  /** Entités dont une réactivation est en cours (bouton désactivé, garde de double clic). */
  busyIds: ReadonlySet<number>;
  /** Refus d'une action de ligne, sous la ligne en la nommant (audit R-27). */
  rowErrors: RowFailures;
  onDismissError: (entityId: number) => void;
}

const TH = 'border-b border-border px-[18px] py-[13px] text-left text-[11px] font-bold uppercase tracking-[1.5px] text-muted-2';
const TD = 'px-[18px] py-3.5 align-middle text-[13.5px]';
const CHIP = 'rounded-pill border border-border bg-surface-subtle px-[9px] py-0.5 text-xs text-muted';
const SMALL = 'h-auto px-2.5 py-[5px] text-[12.5px]';

function useNameEditor(initial: string, onSubmit: (name: string) => Promise<DescribedFailure | null>, onCancel: () => void) {
  const t = useTranslations('organisation.entities');
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<DescribedFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function submit() {
    if (busyRef.current) return;
    if (value.trim() === '') {
      setError({ kind: 'field', message: t('nameRequired'), fieldErrors: {}, reference: null });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const refusal = await onSubmit(value);
    busyRef.current = false;
    setBusy(false);
    if (refusal) setError(refusal);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }

  return { value, setValue, error, busy, submit, onKeyDown, cancel: onCancel };
}
type NameEditor = ReturnType<typeof useNameEditor>;

function NameField({ editor }: { editor: NameEditor }) {
  const t = useTranslations('organisation.entities');
  const errorId = useId();
  const tg = useTranslations('errors.generic');
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <input
          autoFocus
          type="text"
          aria-label={t('nameLabel')}
          aria-invalid={editor.error ? true : undefined}
          aria-describedby={editor.error ? errorId : undefined}
          value={editor.value}
          onChange={(e) => editor.setValue(e.target.value)}
          onKeyDown={editor.onKeyDown}
          className="w-[280px] rounded-lg border-[1.5px] border-accent-ink bg-surface px-3 py-2 text-[13.5px] text-fg shadow-[0_0_0_3px_rgba(110,231,183,0.28)] outline-none"
        />
        <span className="text-xs text-muted-2">{t('inputHint')}</span>
      </div>
      {editor.error && (
        <div id={errorId} role="alert" className="mt-1.5 text-[12.5px] text-danger">
          {/* contre-audit D-6 : le détail du champ, quand le refus en porte un, avant le message général */}
          <p>{editor.error.fieldErrors.name ?? editor.error.message}</p>
          {editor.error.reference && <p className="mt-0.5 text-[11.5px]">{tg('reference', { reference: editor.error.reference })}</p>}
        </div>
      )}
    </div>
  );
}

function EditorButtons({ editor, submitLabel }: { editor: NameEditor; submitLabel: string }) {
  const t = useTranslations('organisation.entities');
  return (
    <div className="flex justify-end gap-1.5">
      <Button type="button" variant="outline" onClick={editor.cancel} className={`${SMALL} border-border-strong font-normal`}>{t('cancel')}</Button>
      <Button type="button" disabled={editor.busy} onClick={() => void editor.submit()} className={`${SMALL} font-bold`}>{submitLabel}</Button>
    </div>
  );
}

function CreateRow({ onCreate, onCancel }: { onCreate: Props['onCreate']; onCancel: () => void }) {
  const t = useTranslations('organisation.entities');
  const editor = useNameEditor('', onCreate, onCancel);
  return (
    <tr className="border-t border-border first:border-t-0">
      <td colSpan={3} className={`${TD} bg-accent-soft`}><NameField editor={editor} /></td>
      <td className={`${TD} bg-accent-soft text-right`}><EditorButtons editor={editor} submitLabel={t('create')} /></td>
    </tr>
  );
}

function AgentChips({ agents }: { agents: AgentSummaryRow[] }) {
  const t = useTranslations('organisation.entities');
  if (agents.length === 0) return <span className="text-muted-2">{t('noAgents')}</span>;
  return (
    <div className="flex flex-wrap gap-[5px]">
      {agents.map((a) => <span key={a.bot_id} className={CHIP}>{a.name}</span>)}
    </div>
  );
}

function RenamingRow({ entity, agents, onRename, onStop }: {
  entity: EntitySummary;
  agents: AgentSummaryRow[];
  onRename: Props['onRename'];
  onStop: () => void;
}) {
  const t = useTranslations('organisation.entities');
  const editor = useNameEditor(
    entity.name,
    async (name) => {
      if (name.trim() === entity.name) {
        onStop();
        return null;
      }
      const err = await onRename(entity.id, name);
      if (!err) onStop();
      return err;
    },
    onStop,
  );
  return (
    <tr className="border-t border-border first:border-t-0">
      <td className={TD}><NameField editor={editor} /></td>
      <td className={TD}><AgentChips agents={agents} /></td>
      <td className={`${TD} ${entity.members === 0 ? 'text-muted-2' : ''}`}>{entity.members}</td>
      <td className={`${TD} whitespace-nowrap text-right`}><EditorButtons editor={editor} submitLabel={t('save')} /></td>
    </tr>
  );
}

function EntityRow({ entity, agents, activeCount, busy, failure, onDismissError, onStartRename, onArchive, onMove, onReactivate }: {
  entity: EntitySummary;
  agents: AgentSummaryRow[];
  activeCount: number;
  busy: boolean;
  failure: RowFailure | undefined;
  onDismissError: () => void;
  onStartRename: () => void;
  onArchive: () => void;
  onMove: () => void;
  onReactivate: () => void;
}) {
  const t = useTranslations('organisation.entities');
  const archived = entity.status === 'archived';
  const canArchive = activeCount > 1;
  const move: ActionMenuItem =
    agents.length === 0
      ? { key: 'move', label: t('menu.move'), onSelect: onMove, disabled: true, disabledReason: t('menu.moveNoAgents') }
      : activeCount <= 1
        ? { key: 'move', label: t('menu.move'), onSelect: onMove, disabled: true, disabledReason: t('menu.moveNoTarget') }
        : { key: 'move', label: t('menu.move'), onSelect: onMove };
  const items: ActionMenuItem[] = [
    { key: 'rename', label: t('menu.rename'), onSelect: onStartRename },
    move,
    ...(canArchive ? [{ key: 'archive', label: t('menu.archive'), onSelect: onArchive, danger: true }] : []),
  ];

  return (
    <>
      <tr className={`border-t border-border first:border-t-0 ${archived ? 'text-muted-2' : ''}`}>
        <td className={TD}>
          <span className={`font-serif text-base ${archived ? '' : 'text-fg'}`}>{entity.name}</span>
        </td>
        <td className={TD}>{archived ? <span className="text-muted-2">{t('noAgents')}</span> : <AgentChips agents={agents} />}</td>
        <td className={`${TD} ${entity.members === 0 ? 'text-muted-2' : ''}`}>{entity.members}</td>
        <td className={`${TD} whitespace-nowrap text-right`}>
          {archived ? (
            <div className="flex items-center justify-end gap-2.5">
              <span className="inline-flex items-center rounded-pill border border-border bg-surface-subtle px-2.5 py-[3px] text-xs font-semibold text-muted-2">{t('archivedPill')}</span>
              <Button type="button" variant="outline" disabled={busy} onClick={onReactivate} className={`${SMALL} border-border-strong font-normal text-fg`}>{t('reactivate')}</Button>
            </div>
          ) : (
            <ActionMenu subject={entity.name} items={items} />
          )}
        </td>
      </tr>
      {failure && <RowErrorRow colSpan={4} rowFailure={failure} onDismiss={onDismissError} />}
    </>
  );
}

export function EntitiesTable({ rows, agentsByEntity, activeCount, creating, onCancelCreate, onCreate, onRename, onArchive, onMove, onReactivate, busyIds, rowErrors, onDismissError }: Props) {
  const t = useTranslations('organisation.entities');
  const [renamingId, setRenamingId] = useState<number | null>(null);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={TH}>{t('colEntity')}</th>
            <th className={TH}>{t('colAgents')}</th>
            <th className={TH}>{t('colMembers')}</th>
            <th className="border-b border-border" />
          </tr>
        </thead>
        <tbody>
          {rows === null && <SkeletonRows cells={['line', 'pill', 'line', 'none']} cellClassName={TD} />}
          {creating && <CreateRow onCreate={onCreate} onCancel={onCancelCreate} />}
          {rows?.map((entity) =>
            renamingId === entity.id ? (
              <RenamingRow
                key={entity.id}
                entity={entity}
                agents={agentsByEntity.get(entity.id) ?? []}
                onRename={onRename}
                onStop={() => setRenamingId(null)}
              />
            ) : (
              <EntityRow
                key={entity.id}
                entity={entity}
                agents={agentsByEntity.get(entity.id) ?? []}
                activeCount={activeCount}
                busy={busyIds.has(entity.id)}
                failure={rowErrors.get(entity.id)}
                onDismissError={() => onDismissError(entity.id)}
                onStartRename={() => setRenamingId(entity.id)}
                onArchive={() => onArchive(entity)}
                onMove={() => onMove(entity)}
                onReactivate={() => onReactivate(entity)}
              />
            ),
          )}
          {rows && <OrphanRowErrors colSpan={4} failures={rowErrors} presentIds={new Set(rows.map((e) => e.id))} onDismiss={onDismissError} />}
        </tbody>
      </table>
    </div>
  );
}
