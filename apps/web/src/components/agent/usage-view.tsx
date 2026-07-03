'use client';
import { useTranslations } from 'next-intl';
import { BarChart } from '@/components/ui/bar-chart';
import type { UsageData } from '@/lib/agent-types';

export function UsageView({
  usage,
  period,
  onPeriod,
}: {
  usage: UsageData;
  period: 7 | 30 | 90;
  onPeriod: (p: 7 | 30 | 90) => void;
}) {
  const t = useTranslations('usage');
  const data = usage.by_day.map((d) => d.cost_usd);
  const hi = data.length ? data.indexOf(Math.max(...data)) : undefined;
  const perDay = usage.by_day.length ? usage.totals.cost_usd / usage.by_day.length : 0;
  const periods: Array<7 | 30 | 90> = [7, 30, 90];

  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-serif text-[26px] font-normal">{t('title')}</h1>
        <div className="flex overflow-hidden rounded-md border border-border-strong">
          {periods.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPeriod(p)}
              className={`px-3.5 py-1.5 text-[13px] ${
                p === period
                  ? 'bg-brand-deep font-semibold text-[#E6EFEA]'
                  : 'bg-surface text-muted hover:bg-surface-subtle'
              }`}
            >
              {t(`p${p}` as 'p7' | 'p30' | 'p90')}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-4">
        <Kpi
          k={t('kpiCost')}
          v={`${usage.totals.cost_usd.toFixed(2)} $`}
          sub={t('perDay', { amount: perDay.toFixed(2) })}
        />
        <Kpi
          k={t('kpiTokens')}
          v={`${Math.round((usage.totals.input_tokens + usage.totals.output_tokens) / 1000)} k`}
          sub={t('tokensSplit', {
            in: Math.round(usage.totals.input_tokens / 1000),
            out: Math.round(usage.totals.output_tokens / 1000),
          })}
        />
        <Kpi k={t('kpiCalls')} v={String(usage.totals.calls)} sub={t('noError')} />
      </div>

      <div className="mb-4 rounded-xl border border-border bg-surface p-[18px] shadow-sm">
        <h3 className="mb-4 font-serif text-base font-normal">{t('costPerDay')}</h3>
        <BarChart data={data} highlightIndex={hi} height={140} />
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
            {usage.by_model.map((m) => (
              <tr key={m.model} className="border-t border-border">
                <td className="px-2.5 py-2.5 font-mono text-[12.5px]">{m.model}</td>
                <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px] text-muted">{m.calls}</td>
                <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px] text-muted">
                  {Math.round(m.input_tokens / 1000)} k
                </td>
                <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px] text-muted">
                  {Math.round(m.output_tokens / 1000)} k
                </td>
                <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px] text-muted">
                  {m.cost_usd.toFixed(2)} $
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-border-strong bg-surface-subtle font-bold">
              <td className="px-2.5 py-2.5">{t('total')}</td>
              <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px]">{usage.totals.calls}</td>
              <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px]">
                {Math.round(usage.totals.input_tokens / 1000)} k
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px]">
                {Math.round(usage.totals.output_tokens / 1000)} k
              </td>
              <td className="px-2.5 py-2.5 text-right font-mono text-[12.5px]">
                {usage.totals.cost_usd.toFixed(2)} $
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-muted-2">{k}</div>
      <div className="mt-1 font-serif text-[30px]">{v}</div>
      <div className="text-[11.5px] text-muted-2">{sub}</div>
    </div>
  );
}
