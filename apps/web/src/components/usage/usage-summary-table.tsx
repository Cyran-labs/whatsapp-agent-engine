'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

interface Row {
  bot_id: string;
  name: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface Total {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export function UsageSummaryTable({ rows, total }: { rows: Row[]; total: Total }) {
  const t = useTranslations('usage');
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="border-b border-border px-[18px] py-3 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-2">
              {t('colAgent')}
            </th>
            {(['colCalls', 'colIn', 'colOut', 'colCost'] as const).map((c) => (
              <th key={c} className="border-b border-border px-[18px] py-3 text-right text-[10.5px] font-bold uppercase tracking-wide text-muted-2">
                {t(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.bot_id} className="border-t border-border hover:bg-surface-subtle">
              <td className="px-[18px] py-3">
                <Link href={`/agents/${r.bot_id}/usage`} className="font-serif text-[15px] hover:underline">
                  {r.name}
                </Link>
              </td>
              <td className="px-[18px] py-3 text-right font-mono text-[12.5px] text-muted">{r.calls}</td>
              <td className="px-[18px] py-3 text-right font-mono text-[12.5px] text-muted">{Math.round(r.input_tokens / 1000)} k</td>
              <td className="px-[18px] py-3 text-right font-mono text-[12.5px] text-muted">{Math.round(r.output_tokens / 1000)} k</td>
              <td className="px-[18px] py-3 text-right font-mono text-[12.5px] text-muted">{r.cost_usd.toFixed(2)} $</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border-strong bg-surface-subtle font-bold">
            <td className="px-[18px] py-3">{t('total')}</td>
            <td className="px-[18px] py-3 text-right font-mono text-[12.5px]">{total.calls}</td>
            <td className="px-[18px] py-3 text-right font-mono text-[12.5px]">{Math.round(total.input_tokens / 1000)} k</td>
            <td className="px-[18px] py-3 text-right font-mono text-[12.5px]">{Math.round(total.output_tokens / 1000)} k</td>
            <td className="px-[18px] py-3 text-right font-mono text-[12.5px]">{total.cost_usd.toFixed(2)} $</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
