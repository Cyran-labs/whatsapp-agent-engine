'use client';
import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BarChart } from '@/components/ui/bar-chart';
import type { UsageData } from '@/lib/agent-types';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { Money, MoneyNote } from '@/components/usage/money';
import { formatDayLabel, formatInteger, formatUsd, usableRate, type MoneyLocale } from '@/lib/money';

/**
 * `usage` nul : chargement en cours ; le titre reste, chiffres en squelette. La période est choisie dans la barre du
 * haut (`PeriodChoice`, rendu par la page) et lue par la page. `title` : « Usage et coûts de {nom} » (spec 10.4), donné
 * par la page.
 */
export function UsageView({ title, usage }: { title: ReactNode; usage: UsageData | null }) {
  const t = useTranslations('usage');
  const tm = useTranslations('money');
  const locale = useLocale() as MoneyLocale;
  const rate = usableRate(usage?.usd_eur_rate);
  const data = usage?.by_day.map((d) => d.cost_usd) ?? [];
  const hi = data.length ? data.indexOf(Math.max(...data)) : undefined;
  const perDay = usage?.by_day.length ? usage.totals.cost_usd / usage.by_day.length : 0;

  return (
    <div className="max-w-[1000px]">
      <div className="mb-5">
        <h1 className="font-serif text-[26px] font-normal">{title}</h1>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-4">
        {usage ? (
          <>
            <Kpi
              k={t('kpiCost')}
              v={<Money usd={usage.totals.cost_usd} rate={rate} />}
              sub={t('perDay', { amount: formatUsd(perDay, locale) })}
            />
            <Kpi
              k={t('kpiTokens')}
              v={formatInteger(usage.totals.input_tokens + usage.totals.output_tokens, locale)}
              sub={t('tokensSplit', {
                in: formatInteger(usage.totals.input_tokens, locale),
                out: formatInteger(usage.totals.output_tokens, locale),
              })}
            />
            <Kpi k={t('kpiCalls')} v={formatInteger(usage.totals.calls, locale)} />
          </>
        ) : (
          <>
            <Kpi k={t('kpiCost')} />
            <Kpi k={t('kpiTokens')} />
            <Kpi k={t('kpiCalls')} />
          </>
        )}
      </div>

      <div className="mb-4 rounded-xl border border-border bg-surface p-[18px] shadow-sm">
        <h3 className="mb-4 font-serif text-base font-normal">{t('costPerDay')}</h3>
        {usage ? <BarChart data={data} labels={usage.by_day.map((d) => formatDayLabel(d.day, locale))} highlightIndex={hi} height={140} emptyLabel={tm('noCost')} /> : <Skeleton className="h-[140px] w-full" />}
      </div>

      <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
        <h3 className="mb-4 font-serif text-base font-normal">{t('byModel')}</h3>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-border px-2.5 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-2">
                {t('colModel')}
              </th>
              {(['colCalls', 'colIn', 'colOut', 'colCost'] as const).map((c) => (
                <th
                  key={c}
                  className="border-b border-border px-2.5 py-2 text-right text-[10.5px] font-bold uppercase tracking-wide text-muted-2"
                >
                  {t(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!usage && (
              <SkeletonRows cells={['line', 'number', 'number', 'number', 'number']} cellClassName="px-2.5 py-2.5" />
            )}
            {usage && (
              <>
                {usage.by_model.map((m) => (
                  <tr key={m.model} className="border-t border-border">
                    <td className="px-2.5 py-2.5 font-mono text-[12.5px]">{m.model}</td>
                    <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px] text-muted">{formatInteger(m.calls, locale)}</td>
                    <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px] text-muted">
                      {formatInteger(m.input_tokens, locale)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px] text-muted">
                      {formatInteger(m.output_tokens, locale)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px] text-muted">
                      <Money usd={m.cost_usd} rate={rate} />
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border-strong bg-surface-subtle font-bold">
                  <td className="px-2.5 py-2.5">{t('total')}</td>
                  <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px]">{formatInteger(usage.totals.calls, locale)}</td>
                  <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px]">
                    {formatInteger(usage.totals.input_tokens, locale)}
                  </td>
                  <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px]">
                    {formatInteger(usage.totals.output_tokens, locale)}
                  </td>
                  <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px]">
                    <Money usd={usage.totals.cost_usd} rate={rate} />
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
        {usage && <MoneyNote rate={rate} className="mt-3 text-[11.5px] text-muted-2" />}
      </div>
    </div>
  );
}

/** Indicateur ; sans valeur, chiffre et sous-titre en squelette. */
function Kpi({ k, v, sub }: { k: string; v?: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-muted-2">{k}</div>
      {v === undefined ? (
        <>
          <Skeleton className="mt-2 h-8 w-24" />
          <Skeleton className="mt-1.5 h-3 w-28" />
        </>
      ) : (
        <>
          <div className="mt-1 font-serif text-[30px]">{v}</div>
          <div className="text-[11.5px] text-muted-2">{sub}</div>
        </>
      )}
    </div>
  );
}
