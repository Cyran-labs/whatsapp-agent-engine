'use client';

import { useTranslations } from 'next-intl';
import { useSession } from '@/components/providers/session-provider';
import { useRoleLabel } from '@/components/shell/use-role-label';
import { isOpenable, monogram } from '@/lib/organizations';

const PILL = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-[3px] text-xs font-semibold';
const TH = 'px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[1.5px] text-muted-2';

export default function OrganisationsPage() {
  const t = useTranslations('account.organisations');
  const roleLabel = useRoleLabel();
  const { me, activeOrg, switchOrg } = useSession();
  const orgs = me.organizations;

  return (
    <>
      <div className="mb-[18px]">
        <h1 className="font-serif text-[26px] font-normal leading-[1.1]">{t('title')}</h1>
        <p className="mt-[5px] text-[12.5px] text-muted-2">{t('subtitle')}</p>
      </div>

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
                        <span className={`${PILL} bg-danger-soft text-[#a32020]`}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                          {t('suspended')}
                        </span>
                      ) : current ? (
                        <span className={`${PILL} bg-accent-soft text-accent-ink`}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                          {t('active')}
                        </span>
                      ) : (
                        <span className={`${PILL} bg-success-soft text-success-ink`}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                          {t('available')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-[13px] text-right align-middle text-[13px]">
                      {!openable ? (
                        <span className="text-muted-2">{t('unavailable')}</span>
                      ) : current ? (
                        <span className="text-muted-2">{t('opened')}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void switchOrg(org.client_id)}
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
    </>
  );
}
