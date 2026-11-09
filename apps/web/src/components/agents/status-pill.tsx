import { useTranslations } from 'next-intl';

const STYLE: Record<string, string> = {
  active: 'bg-success-soft text-success-ink',
  limited: 'bg-warning-soft text-warning-ink',
  draft: 'bg-accent-soft text-accent-ink',
  paused: 'bg-surface-subtle text-muted-2',
};

export function StatusPill({ status }: { status: string }) {
  const t = useTranslations('agents.status');
  const cls = STYLE[status] ?? STYLE.paused;
  const label = ['active', 'limited', 'draft', 'paused'].includes(status) ? t(status) : status;
  return (
    <span className={`inline-flex items-center gap-2 rounded-pill px-3 py-1 text-xs font-semibold ${cls}`}>
      <span className="h-[7px] w-[7px] rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}
