'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { useSession } from '@/components/providers/session-provider';
import { isOpenable, monogram, type OrganizationSummary } from '@/lib/organizations';
import { usePopover } from './use-popover';
import { useRoleLabel } from './use-role-label';

const SEARCH_THRESHOLD = 6;

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function OrgSwitcher() {
  const t = useTranslations('shell.orgSwitcher');
  const roleLabel = useRoleLabel();
  const { me, activeOrg, isPlatformAdmin, switchOrg } = useSession();
  const { open, close, toggle, rootRef, triggerRef, menuRef, onMenuKeyDown, onRootBlur } = usePopover();
  const [query, setQuery] = useState('');

  const orgs = me.organizations;
  if (!activeOrg || (orgs.length <= 1 && !isPlatformAdmin)) return null;

  const showSearch = orgs.length > SEARCH_THRESHOLD;
  const needle = normalize(query.trim());
  const visible = showSearch && needle ? orgs.filter((o) => normalize(o.name).includes(needle)) : orgs;

  function choose(org: OrganizationSummary) {
    if (!isOpenable(org)) return;
    close();
    if (org.client_id !== activeOrg?.client_id) void switchOrg(org.client_id);
  }

  return (
    <div ref={rootRef} className="relative" onBlur={onRootBlur}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          if (!open) setQuery('');
          toggle();
        }}
        className={`flex items-center gap-2 rounded-md border py-1.5 pl-2 pr-2.5 text-[13.5px] font-semibold text-[#E6EFEA] ${
          open ? 'border-brand-mint bg-brand' : 'border-transparent hover:bg-brand/60'
        }`}
      >
        <span
          className="flex h-[22px] w-[22px] items-center justify-center rounded-sm bg-brand-mint text-[10.5px] font-bold text-brand-deep"
          aria-hidden="true"
        >
          {monogram(activeOrg.name)}
        </span>
        {activeOrg.name}
        <span className="ml-0.5 text-[10px] text-[#A7BBB1]" aria-hidden="true">▼</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="group"
          aria-label={t('label')}
          onKeyDown={onMenuKeyDown}
          className="absolute left-0 top-[calc(100%+18px)] z-50 w-80 rounded-lg border border-border bg-surface p-1.5 text-fg shadow-lg"
        >
          <div className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-bold uppercase tracking-[1.3px] text-muted-2">
            {t('heading')}
          </div>
          {showSearch && (
            <input
              data-menu-nav
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="mx-1 mb-1.5 mt-0.5 block w-[calc(100%-8px)] rounded-md border border-border-strong bg-surface px-2.5 py-[7px] text-[13px] text-fg placeholder:text-muted-2"
            />
          )}
          {visible.map((org) => {
            const current = org.client_id === activeOrg.client_id;
            const off = !isOpenable(org);
            return (
              <button
                key={org.client_id}
                data-menu-nav
                type="button"
                aria-current={current ? 'true' : undefined}
                aria-disabled={off ? 'true' : undefined}
                onClick={() => choose(org)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left ${
                  off ? 'cursor-not-allowed opacity-55' : 'hover:bg-surface-subtle'
                } ${current ? 'bg-surface-subtle' : ''}`}
              >
                <span
                  className={`flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-sm border text-[11px] font-bold ${
                    current
                      ? 'border-brand bg-brand text-brand-mint'
                      : 'border-border bg-surface-subtle text-brand dark:text-brand-mint'
                  }`}
                  aria-hidden="true"
                >
                  {monogram(org.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold leading-tight">{org.name}</span>{' '}
                  <span className="block text-[11.5px] text-muted-2">{roleLabel(org)}</span>
                </span>
                {off && (
                  <span className="ml-auto rounded-pill bg-danger-soft px-2 py-px text-[10px] font-semibold text-[#a32020]">
                    {t('suspended')}
                  </span>
                )}
                {current && (
                  <Check data-testid="org-check" className="ml-auto h-4 w-4 text-accent-ink" aria-hidden="true" />
                )}
              </button>
            );
          })}
          {visible.length === 0 && <p className="px-2.5 py-2 text-[13px] text-muted-2">{t('noResult')}</p>}
          <div className="mt-1.5 border-t border-border px-2.5 pb-1 pt-2 text-[11.5px] text-muted-2">
            {t('footer')}
          </div>
        </div>
      )}
    </div>
  );
}
