'use client';
import { useTranslations } from 'next-intl';

/** « Bienvenue dans <organisation>. » à l'arrivée après une invitation acceptée (paramètre `welcome`). */
export function WelcomeBanner({ organization, onDismiss }: { organization: string; onDismiss: () => void }) {
  const t = useTranslations('agents');
  return (
    <div
      role="status"
      className="mb-5 flex items-center justify-between rounded-lg border border-[#BBE7C8] bg-success-soft px-[13px] py-[11px] text-[13px] text-success-ink"
    >
      <span>{t('welcome', { org: organization })}</span>
      <button type="button" onClick={onDismiss} aria-label={t('welcomeDismiss')} className="ml-3 text-base leading-none">
        ×
      </button>
    </div>
  );
}
