'use client';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { isUsageAvailable, type UsageRow, type UsageTotal } from '@/lib/usage';
import { SkeletonRows, type SkeletonCell } from '@/components/ui/skeleton';
import { PartialValue } from '@/components/feedback/partial-value';
import { Money, MoneyNote } from '@/components/usage/money';
import { formatInteger, usableRate, type MoneyLocale, type UsdEurRate } from '@/lib/money';

/**
 * `entityNames` fourni : la colonne Entité est affichée (plusieurs entités actives, aucune filtrée).
 * `rows` et `total` nuls : chargement en cours, en-tête réel et lignes squelettes.
 * `partial` : au moins une ligne est indisponible, le total ne compte que les autres et s'intitule « Total partiel ».
 * `rate` : taux dollar vers euro de la plateforme ; absent, les montants restent en dollars.
 */
export function UsageSummaryTable({
  rows,
  total,
  partial,
  rate,
  entityNames,
}: {
  rows: UsageRow[] | null;
  total: UsageTotal | null;
  partial: boolean;
  rate?: UsdEurRate | null;
  entityNames?: Map<number, string>;
}) {
  const t = useTranslations('usage');
  const locale = useLocale() as MoneyLocale;
  const usable = usableRate(rate);
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
                {isUsageAvailable(r) ? (
                  <>
                    <td className="px-[18px] py-[13px] text-right text-[13px]">{formatInteger(r.calls, locale)}</td>
                    <td className="px-[18px] py-[13px] text-right font-mono text-[12.5px]">{formatInteger(r.input_tokens, locale)}</td>
                    <td className="px-[18px] py-[13px] text-right font-mono text-[12.5px]">{formatInteger(r.output_tokens, locale)}</td>
                    <td className="px-[18px] py-[13px] text-right text-[13px] font-semibold"><Money usd={r.cost_usd} rate={usable} /></td>
                  </>
                ) : (
                  <td colSpan={4} className="px-[18px] py-[13px] text-right text-[13px]"><PartialValue /></td>
                )}
              </tr>
            );
          })}
          {total && (
            <tr className="border-t border-border-strong bg-surface-subtle font-bold">
              <td colSpan={entityNames ? 2 : 1} className="px-[18px] py-[13px] text-[13px]">{partial ? t('totalPartial') : t('total')}</td>
              <td className="px-[18px] py-[13px] text-right text-[13px]">{formatInteger(total.calls, locale)}</td>
              <td className="px-[18px] py-[13px] text-right font-mono text-[12.5px]">{formatInteger(total.input_tokens, locale)}</td>
              <td className="px-[18px] py-[13px] text-right font-mono text-[12.5px]">{formatInteger(total.output_tokens, locale)}</td>
              <td className="px-[18px] py-[13px] text-right text-[13px]"><Money usd={total.cost_usd} rate={usable} /></td>
            </tr>
          )}
        </tbody>
      </table>
      {rows !== null && <MoneyNote rate={usable} className="border-t border-border px-[18px] py-3 text-[11.5px] text-muted-2" />}
    </div>
  );
}
