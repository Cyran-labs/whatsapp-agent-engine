'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import { ActionMenu, type ActionMenuItem } from '@/components/feedback/action-menu';
import { usePopover } from '@/components/shell/use-popover';
import { useRoleName } from '@/components/shell/use-role-label';
import { describeAccess, memberIsSuspended, type GrantLike, type MemberRow } from '@/lib/grants';
import { initialsFromEmail } from '@/lib/organizations';
import { SkeletonRows } from '@/components/ui/skeleton';
import { OrphanRowErrors, RowErrorRow, type RowFailures } from './row-error';

export const TH = 'border-b border-border px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[1.5px] text-muted-2';
export const TD = 'px-4 py-3 align-middle text-[13px]';

export interface MenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Lien externe : l'élément est un `<a>` qui s'ouvre dans un nouvel onglet (`onSelect` n'est pas appelé). */
  href?: string;
}

export function Avatar({ text }: { text: string }) {
  return (
    <span aria-hidden="true" className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-border bg-surface-subtle text-[11px] font-bold text-brand">
      {text}
    </span>
  );
}

/**
 * Menu « ⋯ » des lignes des Connexions (`components/connections/{account,number}-menu.tsx`), remplacé là par
 * `ActionMenu` à la tâche 10 ; les tableaux de l'Organisation l'ont déjà quitté (recette Q-7).
 */
export function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const { open, close, toggle, rootRef, triggerRef, menuRef, onMenuKeyDown, onRootBlur } = usePopover();
  const itemClass = 'block w-full rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none';
  return (
    <div ref={rootRef} className="relative inline-block" onBlur={onRootBlur}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-base ${open ? 'bg-surface-subtle text-fg' : 'text-muted-2 hover:bg-surface-subtle'}`}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-30 mt-1 w-[210px] rounded-lg border border-border bg-surface p-[5px] text-left shadow-lg"
        >
          {items.map((item) =>
            item.href ? (
              <a
                key={item.key}
                role="menuitem"
                data-menu-nav
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
                className={itemClass}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                data-menu-nav
                disabled={item.disabled}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className={`${itemClass} disabled:cursor-default disabled:text-muted-2 disabled:hover:bg-transparent ${item.danger ? 'text-[#a32020] dark:text-[#F3A8A8]' : ''}`}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Accès sur une ou plusieurs lignes : « Admin », « Super manager » + pastille, « Manager · entité ». */
export function AccessLines({ grants, entityNames, muted }: { grants: GrantLike[] | null; entityNames: ReadonlyMap<number, string>; muted?: boolean }) {
  const t = useTranslations('organisation.users');
  const ts = useTranslations('shell.roles');
  const roleName = useRoleName();
  const lines = describeAccess(grants, entityNames, t('archivedEntity'));
  return (
    <div className={`leading-[1.45] ${muted ? 'text-muted-2' : ''}`}>
      {lines.map((line, i) => (
        <div key={i}>
          <span className={muted ? '' : 'font-semibold'}>{roleName(line.role)}</span>
          {line.entity !== undefined && <span className={muted ? '' : 'text-muted'}>{` · ${line.entity}`}</span>}
          {line.readOnly && (
            <span className="ml-[5px] rounded-pill border border-border bg-surface-subtle px-[7px] text-[10.5px] font-semibold text-muted">{ts('readOnly')}</span>
          )}
        </div>
      ))}
    </div>
  );
}

interface Props {
  /** Nul : chargement en cours, en-tête réel et lignes squelettes. */
  members: MemberRow[] | null;
  entityNames: ReadonlyMap<number, string>;
  meId: number;
  onEdit: (member: MemberRow) => void;
  onSuspend: (member: MemberRow) => void;
  onReactivate: (member: MemberRow) => void;
  /** Membres dont une réactivation est en cours (entrée de menu désactivée, garde de double clic). */
  busyIds: ReadonlySet<number>;
  /** Refus d'une action de ligne, affichés sous la ligne en la nommant (audit R-27). */
  rowErrors: RowFailures;
  onDismissError: (userId: number) => void;
}

function StatusPill({ suspended }: { suspended: boolean }) {
  const t = useTranslations('organisation.users');
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-[3px] text-xs font-semibold ${
        suspended ? 'bg-danger-soft text-[#a32020] dark:text-[#F3A8A8]' : 'bg-success-soft text-success-ink'
      }`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {suspended ? t('statusSuspended') : t('statusActive')}
    </span>
  );
}

export function MembersTable({ members, entityNames, meId, onEdit, onSuspend, onReactivate, busyIds, rowErrors, onDismissError }: Props) {
  const t = useTranslations('organisation.users');

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={TH}>{t('colUser')}</th>
            <th className={TH}>{t('colAccess')}</th>
            <th className={TH}>{t('colStatus')}</th>
            <th className="border-b border-border" />
          </tr>
        </thead>
        <tbody>
          {members === null && <SkeletonRows cells={['avatar', 'line', 'pill', 'none']} cellClassName={TD} />}
          {members?.map((m) => {
            const suspended = memberIsSuspended(m.memberships);
            const isMe = m.user_id === meId;
            const reactivate: ActionMenuItem = busyIds.has(m.user_id)
              ? { key: 'reactivate', label: t('menu.reactivate'), onSelect: () => onReactivate(m), disabled: true, disabledReason: t('menu.busy') }
              : { key: 'reactivate', label: t('menu.reactivate'), onSelect: () => onReactivate(m) };
            const items: ActionMenuItem[] = [
              { key: 'edit', label: t('menu.edit'), onSelect: () => onEdit(m) },
              suspended ? reactivate : { key: 'suspend', label: t('menu.suspend'), onSelect: () => onSuspend(m), danger: true },
            ];
            const failure = rowErrors.get(m.user_id);
            return (
              <Fragment key={m.user_id}>
                <tr className="border-t border-border first:border-t-0">
                  <td className={TD}>
                    <div className="flex items-center gap-2.5">
                      <Avatar text={initialsFromEmail(m.email)} />
                      <span className={`font-semibold ${suspended ? 'text-muted-2' : ''}`}>{m.email}</span>
                      {isMe && <span className="ml-1.5 rounded-pill border border-border px-[7px] text-[10.5px] font-semibold text-muted-2">{t('you')}</span>}
                    </div>
                  </td>
                  <td className={TD}><AccessLines grants={m.memberships} entityNames={entityNames} muted={suspended} /></td>
                  <td className={TD}><StatusPill suspended={suspended} /></td>
                  <td className={`${TD} whitespace-nowrap text-right`}>
                    {!isMe && <ActionMenu subject={m.email} items={items} />}
                  </td>
                </tr>
                {failure && <RowErrorRow colSpan={4} rowFailure={failure} onDismiss={() => onDismissError(m.user_id)} />}
              </Fragment>
            );
          })}
          {members && <OrphanRowErrors colSpan={4} failures={rowErrors} presentIds={new Set(members.map((m) => m.user_id))} onDismiss={onDismissError} />}
        </tbody>
      </table>
    </div>
  );
}
