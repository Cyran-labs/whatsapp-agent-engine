import { useTranslations } from 'next-intl';
import { BarChart } from '@/components/ui/bar-chart';
import type { UsageData } from '@/lib/agent-types';
import { Skeleton } from '@/components/ui/skeleton';

/** `usage` nul : chargement en cours, montant, graphique et ligne de tokens en squelette. */
export function CostCard({ usage }: { usage: UsageData | null }) {
  const t = useTranslations('overview');
  const header = (
    <h3 className="flex items-baseline justify-between font-serif text-base font-normal">
      {t('costTitle')}
      <span className="font-sans text-[11px] text-muted-2">{t('costRange')}</span>
    </h3>
  );
  if (!usage) {
    return (
      <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
        {header}
        <Skeleton className="mt-1.5 h-8 w-28" />
        <Skeleton className="mb-3.5 mt-1.5 h-3 w-24" />
        <Skeleton className="h-20 w-full" />
        <div className="mt-3 border-t border-border pt-2.5">
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    );
  }
  const days = usage.by_day.slice(-7);
  const data = days.map((d) => d.cost_usd);
  const hi = data.length ? data.indexOf(Math.max(...data)) : undefined;
  const perDay = usage.by_day.length ? usage.totals.cost_usd / usage.by_day.length : 0;
  return (
    <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      {header}
      <div className="font-serif text-[30px]">{usage.totals.cost_usd.toFixed(2)} $</div>
      <div className="mb-3.5 text-[11.5px] text-muted-2">{t('perDay', { amount: perDay.toFixed(2) })}</div>
      <BarChart data={data} highlightIndex={hi} />
      <div className="mt-3 border-t border-border pt-2.5 text-[11.5px] text-muted-2">
        {t('tokensLine', {
          in: `${Math.round(usage.totals.input_tokens / 1000)} k`,
          out: `${Math.round(usage.totals.output_tokens / 1000)} k`,
          errors: 0,
        })}
      </div>
    </div>
  );
}
