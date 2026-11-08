'use client';

import { useTranslations } from 'next-intl';
import { CircleDot, LogOut } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { useSession } from '@/components/providers/session-provider';
import { initialsFromEmail } from '@/lib/organizations';
import { usePopover } from './use-popover';
import { useRoleLabel } from './use-role-label';

interface Props {
  active?: 'agents' | 'usage' | 'organisation' | 'account';
}

export function UserMenu({ active }: Props) {
  const t = useTranslations('shell.userMenu');
  const tRoles = useTranslations('shell.roles');
  const roleLabel = useRoleLabel();
  const router = useRouter();
  const { me, activeOrg, isPlatformAdmin } = useSession();
  const { open, close, toggle, rootRef, triggerRef, menuRef, onMenuKeyDown, onRootBlur } = usePopover();

  async function logout() {
    close();
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // best-effort : on redirige vers login quoi qu'il arrive
    }
    router.push('/login');
  }

  const role = isPlatformAdmin ? tRoles('implicitAdmin') : activeOrg ? roleLabel(activeOrg) : '';
  const roleLine = [role, activeOrg?.name].filter((part): part is string => !!part).join(' · ');
  const lit = open || active === 'account' || isPlatformAdmin;

  return (
    <div ref={rootRef} className="relative" onBlur={onRootBlur}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={me.email}
        onClick={toggle}
        className={`relative flex h-[34px] w-[34px] items-center justify-center rounded-pill border bg-brand text-[12.5px] font-bold text-brand-mint ${
          lit ? 'border-brand-mint' : 'border-brand'
        } ${open || active === 'account' ? 'shadow-[0_0_0_3px_rgba(110,231,183,0.18)]' : ''}`}
      >
        {initialsFromEmail(me.email)}
        {isPlatformAdmin && (
          <span
            data-testid="platform-badge-dot"
            aria-hidden="true"
            className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-brand-deep bg-white text-[8px] font-extrabold text-brand-deep"
          >
            ★
          </span>
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={onMenuKeyDown}
          className="absolute right-[-6px] top-[calc(100%+19px)] z-50 w-64 rounded-lg border border-border bg-surface p-[5px] text-fg shadow-lg"
        >
          <div className="mb-[5px] border-b border-border px-2.5 pb-2.5 pt-[9px]">
            <div className="break-all text-[13px] font-semibold leading-[1.3]">{me.email}</div>
            {roleLine && <div className="mt-px text-[11.5px] text-muted-2">{roleLine}</div>}
            {isPlatformAdmin && (
              <span className="mt-1.5 inline-block rounded-pill bg-brand-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px] text-brand-mint">
                {t('operator')}
              </span>
            )}
          </div>
          <Link
            href="/account/organisations"
            role="menuitem"
            data-menu-nav
            onClick={close}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] hover:bg-surface-subtle"
          >
            <CircleDot className="h-4 w-4 text-muted-2" aria-hidden="true" />
            {t('account')}
          </Link>
          <div className="my-[5px] border-t border-border" />
          <button
            type="button"
            role="menuitem"
            data-menu-nav
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13.5px] hover:bg-surface-subtle"
          >
            <LogOut className="h-4 w-4 text-muted-2" aria-hidden="true" />
            {t('logout')}
          </button>
        </div>
      )}
    </div>
  );
}
