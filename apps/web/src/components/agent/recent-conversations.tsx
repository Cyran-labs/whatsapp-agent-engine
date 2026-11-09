import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';

export interface RecentRow {
  phone: string;
  name: string | null;
  last: string;
  qualified: boolean;
  when: string;
}

/** `rows` nul : chargement en cours, trois lignes squelettes. */
export function RecentConversations({ rows }: { rows: RecentRow[] | null }) {
  const t = useTranslations('overview');
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <h3 className="mb-3.5 flex items-baseline justify-between font-serif text-base font-normal">
        {t('recentTitle')}
        <span className="font-sans text-[11px] text-muted-2">{t('seeAll')}</span>
      </h3>
      {rows === null ? (
        [0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5 border-b border-border py-2.5 last:border-b-0">
            <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-3 w-10" />
          </div>
        ))
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-muted-2">{t('noRecent')}</p>
      ) : (
        rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2.5 border-b border-border py-2.5 text-[13px] last:border-b-0">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-surface-subtle text-[10px] font-bold text-brand">
              {(r.name ?? r.phone).slice(0, 2).toUpperCase()}
            </span>
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-muted">{r.last}</span>
            {r.qualified && (
              <span className="rounded-pill bg-success-soft px-2 py-px text-[10px] font-semibold text-success-ink">
                {t('infoCollected')}
              </span>
            )}
            <span className="text-[11px] text-muted-2">{r.when}</span>
          </div>
        ))
      )}
    </div>
  );
}
