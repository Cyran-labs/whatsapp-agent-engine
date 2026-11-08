'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { EntitySummary } from '@/lib/entities';
import type { AgentSummaryRow } from '@/lib/onboarding';
import { usePopover } from '@/components/shell/use-popover';
import { SkeletonRows } from '@/components/ui/skeleton';

interface Props {
  /** Nul : chargement en cours, en-tête réel et lignes squelettes. */
  rows: EntitySummary[] | null;
  agentsByEntity: Map<number, AgentSummaryRow[]>;
  /** Nombre d'entités actives de l'organisation (« Archiver » est absent de la dernière). */
  activeCount: number;
  creating: boolean;
  onCancelCreate: () => void;
  /** Les trois envois renvoient le message d'erreur du moteur, ou null en cas de succès. */
  onCreate: (name: string) => Promise<string | null>;
  onRename: (id: number, name: string) => Promise<string | null>;
  onArchive: (entity: EntitySummary) => void;
  onMove: (entity: EntitySummary) => void;
  onReactivate: (entity: EntitySummary) => void;
}

const TH = 'border-b border-border px-[18px] py-[13px] text-left text-[11px] font-bold uppercase tracking-[1.5px] text-muted-2';
const TD = 'px-[18px] py-3.5 align-middle text-[13.5px]';
const CHIP = 'rounded-pill border border-border bg-surface-subtle px-[9px] py-0.5 text-xs text-muted';
const SMALL = 'h-auto px-2.5 py-[5px] text-[12.5px]';

function useNameEditor(initial: string, onSubmit: (name: string) => Promise<string | null>, onCancel: () => void) {
  const t = useTranslations('organisation.entities');
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function submit() {
    if (busyRef.current) return;
    if (value.trim() === '') {
      setError(t('nameRequired'));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const err = await onSubmit(value);
    busyRef.current = false;
    setBusy(false);
    if (err) setError(err);
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
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <input
          autoFocus
          type="text"
          aria-label={t('nameLabel')}
          value={editor.value}
          onChange={(e) => editor.setValue(e.target.value)}
          onKeyDown={editor.onKeyDown}
          className="w-[280px] rounded-lg border-[1.5px] border-accent-ink bg-surface px-3 py-2 text-[13.5px] text-fg shadow-[0_0_0_3px_rgba(110,231,183,0.28)] outline-none"
        />
        <span className="text-xs text-muted-2">{t('inputHint')}</span>
      </div>
      {editor.error && <p role="alert" className="mt-1.5 text-[12.5px] text-danger">{editor.error}</p>}
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

function RowMenu({ entity, canMove, canArchive, onRename, onMove, onArchive }: {
  entity: EntitySummary;
  canMove: boolean;
  canArchive: boolean;
  onRename: () => void;
  onMove: () => void;
  onArchive: () => void;
}) {
  const t = useTranslations('organisation.entities');
  const { open, close, toggle, rootRef, triggerRef, menuRef, onMenuKeyDown, onRootBlur } = usePopover();
  const item = 'block w-full rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none';
  const pick = (action: () => void) => () => {
    close();
    action();
  };

  return (
    <div ref={rootRef} className="relative inline-block" onBlur={onRootBlur}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('menuLabel', { name: entity.name })}
        onClick={toggle}
        className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-md text-base ${open ? 'bg-surface-subtle text-fg' : 'text-muted-2 hover:bg-surface-subtle'}`}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('menuLabel', { name: entity.name })}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-30 mt-1 w-[220px] rounded-lg border border-border bg-surface p-[5px] text-left shadow-lg"
        >
          <button type="button" role="menuitem" data-menu-nav onClick={pick(onRename)} className={item}>{t('menu.rename')}</button>
          <button
            type="button"
            role="menuitem"
            disabled={!canMove}
            {...(canMove ? { 'data-menu-nav': true } : {})}
            onClick={pick(onMove)}
            className={`${item} disabled:cursor-default disabled:text-muted-2 disabled:hover:bg-transparent`}
          >
            {t('menu.move')}
          </button>
          {canArchive && (
            <button type="button" role="menuitem" data-menu-nav onClick={pick(onArchive)} className={`${item} text-[#a32020] dark:text-[#F3A8A8]`}>
              {t('menu.archive')}
            </button>
          )}
        </div>
      )}
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

function EntityRow({ entity, agents, activeCount, onStartRename, onArchive, onMove, onReactivate }: {
  entity: EntitySummary;
  agents: AgentSummaryRow[];
  activeCount: number;
  onStartRename: () => void;
  onArchive: () => void;
  onMove: () => void;
  onReactivate: () => void;
}) {
  const t = useTranslations('organisation.entities');
  const archived = entity.status === 'archived';

  return (
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
            <Button type="button" variant="outline" onClick={onReactivate} className={`${SMALL} border-border-strong font-normal text-fg`}>{t('reactivate')}</Button>
          </div>
        ) : (
          <RowMenu
            entity={entity}
            canMove={agents.length > 0 && activeCount > 1}
            canArchive={activeCount > 1}
            onRename={onStartRename}
            onMove={onMove}
            onArchive={onArchive}
          />
        )}
      </td>
    </tr>
  );
}

export function EntitiesTable({ rows, agentsByEntity, activeCount, creating, onCancelCreate, onCreate, onRename, onArchive, onMove, onReactivate }: Props) {
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
                onStartRename={() => setRenamingId(entity.id)}
                onArchive={() => onArchive(entity)}
                onMove={() => onMove(entity)}
                onReactivate={() => onReactivate(entity)}
              />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
