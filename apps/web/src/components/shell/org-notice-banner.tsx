'use client';

import { useTranslations } from 'next-intl';
import { useSession } from '@/components/providers/session-provider';
import type { OrgNotice } from '@/lib/org-notice';
import { useRoleLabel } from './use-role-label';

/**
 * Bandeau d'information en haut de page après un événement d'organisation : il nomme l'organisation et, si l'accès
 * demeure, le rôle ; pour une organisation suspendue, qui contacter selon le rôle qu'on y a.
 */
export function OrgNoticeBanner() {
  const t = useTranslations('shell.orgNotice');
  const roleLabel = useRoleLabel();
  const { notice, dismissNotice } = useSession();
  if (!notice) return null;
  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-between border-b border-warning bg-warning-soft px-6 py-2.5 text-[13px] text-warning-ink"
    >
      <span>{text(notice)}</span>
      <button type="button" onClick={dismissNotice} aria-label={t('dismiss')} className="ml-3 text-base leading-none">
        ×
      </button>
    </div>
  );

  function text(n: OrgNotice): string {
    if (n.kind === 'access' && n.role) {
      return t('access', { org: n.org, role: roleLabel({ role: n.role, read_only: n.readOnly === true }) });
    }
    // L'administrateur de l'organisation suspendue est celui qu'on dirait de contacter : il ne reste que le support.
    if (n.kind === 'suspended' && n.role === 'admin') return t('suspendedSupport', { org: n.org });
    return t(n.kind === 'access' ? 'accessLost' : n.kind, { org: n.org });
  }
}
