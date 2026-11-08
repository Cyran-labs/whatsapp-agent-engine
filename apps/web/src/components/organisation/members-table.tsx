'use client';

import { useTranslations } from 'next-intl';
import { usePopover } from '@/components/shell/use-popover';
import { useRoleName } from '@/components/shell/use-role-label';
import { describeAccess, memberIsSuspended, type GrantLike, type MemberRow } from '@/lib/grants';
import { initialsFromEmail } from '@/lib/organizations';

export const TH = 'border-b border-border px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[1.5px] text-muted-2';
export const TD = 'px-4 py-3 align-middle text-[13px]';

export interface MenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export function Avatar({ text }: { text: string }) {
  return (
    <span aria-hidden="true" className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-border bg-surface-subtle text-[11px] font-bold text-brand">
      {text}
    </span>
  );
}

/** Menu « ⋯ » d'une ligne (clavier et fermeture via `usePopover`). */
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
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              data-menu-nav
              onClick={() => {
                close();
                item.onSelect();
              }}
              className={`${itemClass} ${item.danger ? 'text-[#a32020] dark:text-[#F3A8A8]' : ''}`}
            >
              {item.label}
            </button>
          ))}
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
  members: MemberRow[];
  entityNames: ReadonlyMap<number, string>;
  meId: number;
  onEdit: (member: MemberRow) => void;
  onSuspend: (member: MemberRow) => void;
  onReactivate: (member: MemberRow) => void;
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

export function MembersTable({ members, entityNames, meId, onEdit, onSuspend, onReactivate }: Props) {
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
          {members.map((m) => {
            const suspended = memberIsSuspended(m.memberships);
            const isMe = m.user_id === meId;
            const items: MenuItem[] = [
              { key: 'edit', label: t('menu.edit'), onSelect: () => onEdit(m) },
              suspended
                ? { key: 'reactivate', label: t('menu.reactivate'), onSelect: () => onReactivate(m) }
                : { key: 'suspend', label: t('menu.suspend'), onSelect: () => onSuspend(m), danger: true },
            ];
            return (
              <tr key={m.user_id} className="border-t border-border first:border-t-0">
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
                  {!isMe && <RowMenu label={t('menuLabel', { email: m.email })} items={items} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
