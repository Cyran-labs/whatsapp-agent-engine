'use client';

import { useTranslations } from 'next-intl';
import { useSession } from '@/components/providers/session-provider';

/** Bandeau d'information en haut de page après une erreur d'organisation (accès changé, organisation suspendue). */
export function OrgNoticeBanner() {
  const t = useTranslations('shell.orgNotice');
  const { notice, dismissNotice } = useSession();
  if (!notice) return null;
  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-between border-b border-warning bg-warning-soft px-6 py-2.5 text-[13px] text-warning-ink"
    >
      <span>{t(notice)}</span>
      <button type="button" onClick={dismissNotice} aria-label={t('dismiss')} className="ml-3 text-base leading-none">
        ×
      </button>
    </div>
  );
}
