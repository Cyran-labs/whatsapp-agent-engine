'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import type { UsageRow, UsageTotal } from '@/lib/usage';
import { SkeletonRows, type SkeletonCell } from '@/components/ui/skeleton';

/**
 * `entityNames` fourni : la colonne Entité est affichée (plusieurs entités actives, aucune filtrée).
 * `rows` et `total` nuls : chargement en cours, en-tête réel et lignes squelettes.
 */
export function UsageSummaryTable({ rows, total, entityNames }: { rows: UsageRow[] | null; total: UsageTotal | null; entityNames?: Map<number, string> }) {
  const t = useTranslations('usage');
  const th = 'border-b border-border px-[18px] py-3 text-[11px] font-bold uppercase tracking-[1.5px] text-muted-2';
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${th} text-left`}>{t('colAgent')}</th>
            {entityNames && <th className={`${th} text-left`}>{t('colEntity')}</th>}
            {(['colCalls', 'colIn', 'colOut', 'colCost'] as const).map((c) => (
              <th key={c} className={`${th} text-right`}>{t(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows === null && (
            <SkeletonRows
              cells={['line', ...(entityNames ? ['pill' as const] : []), 'number', 'number', 'number', 'number'] satisfies SkeletonCell[]}
              cellClassName="px-[18px] py-[13px]"
            />
          )}
          {rows?.map((r) => {
            const entityName = r.entity_id === null ? undefined : entityNames?.get(r.entity_id);
            return (
              <tr key={r.bot_id} className="border-t border-border first:border-t-0 hover:bg-surface-subtle">
                <td className="px-[18px] py-[13px]">
                  <Link href={`/agents/${r.bot_id}/usage`} className="font-serif text-base hover:underline">
                    {r.name}
                  </Link>
                </td>
                {entityNames && (
                  <td className="px-[18px] py-[13px]">
                    {entityName && (
                      <span className="inline-block rounded-pill border border-border bg-surface-subtle px-[9px] py-0.5 text-xs text-muted">{entityName}</span>
                    )}
                  </td>
                )}
                <td className="px-[18px] py-[13px] text-right text-[13px]">{r.calls}</td>
                <td className="px-[18px] py-[13px] text-right font-mono text-[12.5px]">{Math.round(r.input_tokens / 1000)} k</td>
                <td className="px-[18px] py-[13px] text-right font-mono text-[12.5px]">{Math.round(r.output_tokens / 1000)} k</td>
                <td className="px-[18px] py-[13px] text-right text-[13px] font-semibold">{r.cost_usd.toFixed(2)} $</td>
              </tr>
            );
          })}
          {total && (
            <tr className="border-t border-border-strong bg-surface-subtle font-bold">
              <td colSpan={entityNames ? 2 : 1} className="px-[18px] py-[13px] text-[13px]">{t('total')}</td>
              <td className="px-[18px] py-[13px] text-right text-[13px]">{total.calls}</td>
              <td className="px-[18px] py-[13px] text-right font-mono text-[12.5px]">{Math.round(total.input_tokens / 1000)} k</td>
              <td className="px-[18px] py-[13px] text-right font-mono text-[12.5px]">{Math.round(total.output_tokens / 1000)} k</td>
              <td className="px-[18px] py-[13px] text-right text-[13px]">{total.cost_usd.toFixed(2)} $</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
