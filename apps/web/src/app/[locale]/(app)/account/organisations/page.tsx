'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { InlineError } from '@/components/feedback/inline-error';
import { useSession } from '@/components/providers/session-provider';
import { useRoleLabel } from '@/components/shell/use-role-label';
import { PageContent, PageHeader } from '@/components/shell/page-header';
import { isOpenable, monogram } from '@/lib/organizations';

const PILL = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-[3px] text-xs font-semibold';
const TH = 'border-b border-border px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[1.5px] text-muted-2';

export default function OrganisationsPage() {
  const t = useTranslations('account.organisations');
  const roleLabel = useRoleLabel();
  const { me, activeOrg, switchOrg } = useSession();
  const orgs = me.organizations;
  const pendingRef = useRef(false);
  const [failure, setFailure] = useState<{ message: string; reference: string | null } | null>(null);

  /** Un seul changement à la fois ; un refus s'affiche sur la page, au-dessus de la liste. */
  async function open(clientId: string): Promise<void> {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setFailure(null);
    try {
      const result = await switchOrg(clientId);
      if (!result.ok) setFailure({ message: result.message, reference: result.reference });
    } finally {
      pendingRef.current = false;
    }
  }

  return (
    <PageContent>
      <PageHeader title={t('title')} description={t('subtitle')} />

      {failure !== null && (
        <div className="mb-3">
          <InlineError message={failure.message} reference={failure.reference} />
        </div>
      )}

      {orgs.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-[13px] text-muted-2 shadow-sm">
          {t('empty')}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>{t('colOrganisation')}</th>
                <th className={TH}>{t('colRole')}</th>
                <th className={TH}>{t('colStatus')}</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => {
                const current = org.client_id === activeOrg?.client_id;
                const openable = isOpenable(org);
                return (
                  <tr
                    key={org.client_id}
                    className={`border-t border-border first:border-t-0 ${current ? 'bg-surface-subtle' : ''}`}
                  >
                    <td className="px-4 py-[13px] align-middle text-[13px]">
                      <div className="flex items-center gap-[11px]">
                        <span
                          aria-hidden="true"
                          className={`flex h-[30px] w-[30px] items-center justify-center rounded-sm border text-[11.5px] font-bold ${
                            current
                              ? 'border-brand bg-brand text-brand-mint'
                              : 'border-border bg-surface-subtle text-brand dark:text-brand-mint'
                          }`}
                        >
                          {monogram(org.name)}
                        </span>
                        <span className="font-serif text-base">{org.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-[13px] align-middle text-[13px]">{roleLabel(org)}</td>
                    <td className="px-4 py-[13px] align-middle text-[13px]">
                      {!openable ? (
                        <span className={`${PILL} bg-danger-soft text-danger-ink`}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                          {t('suspended')}
                        </span>
                      ) : current ? (
                        <span className={`${PILL} bg-accent-soft text-accent-ink`}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                          {t('current')}
                        </span>
                      ) : (
                        <span className={`${PILL} bg-success-soft text-success-ink`}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                          {t('openable')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-[13px] text-right align-middle text-[13px]">
                      {!openable ? (
                        <span className="text-muted-2">{t('unavailable')}</span>
                      ) : current ? null : (
                        <button
                          type="button"
                          onClick={() => void open(org.client_id)}
                          className="rounded-md border border-border-strong bg-surface px-[15px] py-2 text-[13px] text-fg hover:bg-surface-subtle"
                        >
                          {t('open')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageContent>
  );
}
