'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { InvitationRow } from '@/lib/grants';
import { initialsFromEmail } from '@/lib/organizations';
import { AccessLines, Avatar, RowMenu, TD } from './members-table';

interface Props {
  invitations: InvitationRow[];
  entityNames: ReadonlyMap<number, string>;
  /** Identifiants des invitations en cours de renvoi (bouton et entrée de menu désactivés). */
  resendingIds: ReadonlySet<number>;
  onResend: (invitation: InvitationRow) => void;
  onRevoke: (invitation: InvitationRow) => void;
}

function ExpiryPill({ expiresAt }: { expiresAt: string }) {
  const t = useTranslations('organisation.users');
  const format = useFormatter();
  const date = new Date(expiresAt);
  const expired = Number.isNaN(date.getTime()) || date.getTime() <= Date.now();
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-[3px] text-xs font-semibold ${
        expired ? 'bg-danger-soft text-[#a32020] dark:text-[#F3A8A8]' : 'bg-warning-soft text-warning-ink'
      }`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {expired ? t('expired') : t('expires', { date: format.dateTime(date, { day: 'numeric', month: 'short' }) })}
    </span>
  );
}

export function InvitationsTable({ invitations, entityNames, resendingIds, onResend, onRevoke }: Props) {
  const t = useTranslations('organisation.users');

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse">
        <tbody>
          {invitations.map((inv) => (
            <tr key={inv.id} className="border-t border-border first:border-t-0">
              <td className={TD}>
                <div className="flex items-center gap-2.5">
                  <Avatar text={initialsFromEmail(inv.email)} />
                  <span className="font-semibold">{inv.email}</span>
                </div>
              </td>
              <td className={TD}><AccessLines grants={inv.grants} entityNames={entityNames} /></td>
              <td className={TD}><ExpiryPill expiresAt={inv.expires_at} /></td>
              <td className={`${TD} whitespace-nowrap text-right`}>
                <div className="flex items-center justify-end gap-1.5">
                  <Button type="button" variant="outline" disabled={resendingIds.has(inv.id)} onClick={() => onResend(inv)} className="h-auto border-border-strong px-2.5 py-[5px] text-[12.5px] font-normal">
                    {t('resend')}
                  </Button>
                  <RowMenu
                    label={t('menuLabel', { email: inv.email })}
                    items={[
                      { key: 'resend', label: t('menu.resend'), onSelect: () => onResend(inv), disabled: resendingIds.has(inv.id) },
                      { key: 'revoke', label: t('menu.revoke'), onSelect: () => onRevoke(inv), danger: true },
                    ]}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
