import { useLocale, useTranslations } from 'next-intl';
import { BarChart } from '@/components/ui/bar-chart';
import type { UsageData } from '@/lib/agent-types';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadError, type RetryState } from '@/components/feedback/load-error';
import { Money, MoneyNote } from '@/components/usage/money';
import { formatDayLabel, formatInteger, perDayMessage, usableRate, type MoneyLocale } from '@/lib/money';
import { lastParisDays, perDayAverage } from '@/lib/period';
import { FAILED, type Failed } from './panel-ui';

/**
 * Durée de la période du montant de la carte (« 30 derniers jours ») : le BFF lit l'usage sans `since`, et le moteur prend
 * alors les 30 derniers jours (`src/api/admin/routes/dashboard.ts`).
 */
const COST_PERIOD_DAYS = 30;

/**
 * `usage` nul : chargement en cours, montant, graphique et ligne de tokens en squelette. `FAILED` : « Coûts
 * indisponibles » avec « Réessayer », jamais un montant à zéro (audit R-17).
 */
export function CostCard({ usage, onRetry, retry }: { usage: UsageData | null | Failed; onRetry: () => void; retry?: RetryState }) {
  const t = useTranslations('overview');
  const tm = useTranslations('money');
  const locale = useLocale() as MoneyLocale;
  const header = (
    <h3 className="flex items-baseline justify-between font-serif text-base font-normal">
      {t('costTitle')}
      <span className="font-sans text-[11px] text-muted-2">{t('costRange')}</span>
    </h3>
  );
  if (usage === FAILED) {
    return (
      <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
        {header}
        <div className="mt-3">
          <LoadError message={t('costUnavailable')} onRetry={onRetry} retry={retry} />
        </div>
      </div>
    );
  }
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
  // « 7 derniers jours » (relecture tâche 9, I-1) : les 7 jours du calendrier de Paris qui finissent aujourd'hui ; le
  // moteur ne renvoie que les jours avec au moins un appel, un jour absent est une barre à zéro.
  const costByDay = new Map(usage.by_day.map((d) => [d.day, d.cost_usd]));
  const days = lastParisDays(7);
  const data = days.map((day) => costByDay.get(day) ?? 0);
  const hi = data.length ? data.indexOf(Math.max(...data)) : undefined;
  const rate = usableRate(usage.usd_eur_rate);
  const perDayText = perDayMessage(perDayAverage(usage.totals.cost_usd, COST_PERIOD_DAYS), locale);
  return (
    <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      {header}
      <div className="font-serif text-[30px]">
        <Money usd={usage.totals.cost_usd} rate={rate} />
      </div>
      <div className="text-[11.5px] text-muted-2">{t(perDayText.key, { amount: perDayText.amount })}</div>
      <MoneyNote rate={rate} className="mb-3.5 text-[11.5px] text-muted-2" />
      {/* prototype 7 : le montant couvre 30 jours, le graphique les 7 derniers ; chacun dit sa période */}
      <div className="mb-1.5 text-[11px] text-muted-2">{t('costChartRange')}</div>
      <BarChart data={data} labels={days.map((day) => formatDayLabel(day, locale))} highlightIndex={hi} emptyLabel={tm('noCost')} />
      <div className="mt-3 border-t border-border pt-2.5 text-[11.5px] text-muted-2">
        {t('tokensLine', {
          in: formatInteger(usage.totals.input_tokens, locale),
          out: formatInteger(usage.totals.output_tokens, locale),
        })}
      </div>
    </div>
  );
}
