'use client';

import { Fragment } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { HintBubble, useHint } from '@/components/shell/coming-soon';
import { Button } from '@/components/ui/button';
import { ActionMenu, type ActionMenuItem } from '@/components/feedback/action-menu';
import type { InvitationRow } from '@/lib/grants';
import { initialsFromEmail } from '@/lib/organizations';
import { AccessLines, Avatar, TD } from './members-table';
import { OrphanRowErrors, RowErrorRow, type RowFailures } from './row-error';

interface Props {
  invitations: InvitationRow[];
  entityNames: ReadonlyMap<number, string>;
  /** Identifiants des invitations dont une action est en cours (bouton désactivé, entrée de menu désactivée avec sa raison). */
  busyIds: ReadonlySet<number>;
  /** Refus d'une action de ligne, sous la ligne en la nommant (audit R-27) ; une invitation disparue à la relecture garde le sien. */
  rowErrors: RowFailures;
  onDismissError: (invitationId: number) => void;
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

/**
 * « Renvoyer » d'une invitation. Pendant un envoi de la ligne, il reste focalisable, grisé (`aria-disabled`), et dit
 * pourquoi dans une bulle (« Envoi en cours ») ; un clic n'envoie rien (relecture tâche 10, m-2).
 */
function ResendButton({ busy, onResend }: { busy: boolean; onResend: () => void }) {
  const t = useTranslations('organisation.users');
  const hint = useHint<HTMLButtonElement>();
  return (
    <>
      <Button
        type="button"
        variant="outline"
        {...(busy ? { 'aria-disabled': true, ...hint.triggerProps } : { onClick: onResend })}
        className="h-auto border-border-strong px-2.5 py-[5px] text-[12.5px] font-normal aria-disabled:cursor-not-allowed aria-disabled:text-muted-2 aria-disabled:hover:bg-transparent"
      >
        {t('resend')}
      </Button>
      {busy && <HintBubble id={hint.id} open={hint.open} text={t('menu.busy')} anchor={hint.anchorRef} />}
    </>
  );
}

export function InvitationsTable({ invitations, entityNames, busyIds, rowErrors, onDismissError, onResend, onRevoke }: Props) {
  const t = useTranslations('organisation.users');

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse">
        <tbody>
          {invitations.map((inv) => {
            const busy = busyIds.has(inv.id);
            const revoke: ActionMenuItem = busy
              ? { key: 'revoke', label: t('menu.revoke'), onSelect: () => onRevoke(inv), danger: true, disabled: true, disabledReason: t('menu.busy') }
              : { key: 'revoke', label: t('menu.revoke'), onSelect: () => onRevoke(inv), danger: true };
            const failure = rowErrors.get(inv.id);
            return (
              <Fragment key={inv.id}>
                <tr className="border-t border-border first:border-t-0">
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
                      <ResendButton busy={busy} onResend={() => onResend(inv)} />
                      {/* « Renvoyer » n'existe qu'en bouton : le menu ne le répète pas (prototype 9). */}
                      <ActionMenu subject={inv.email} items={[revoke]} />
                    </div>
                  </td>
                </tr>
                {failure && <RowErrorRow colSpan={4} rowFailure={failure} onDismiss={() => onDismissError(inv.id)} />}
              </Fragment>
            );
          })}
          <OrphanRowErrors colSpan={4} failures={rowErrors} presentIds={new Set(invitations.map((i) => i.id))} onDismiss={onDismissError} />
        </tbody>
      </table>
    </div>
  );
}
