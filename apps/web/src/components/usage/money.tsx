'use client';
import { useLocale, useTranslations } from 'next-intl';
import { formatEurApprox, formatRate, formatRateDate, formatUsd, usableRate, type MoneyLocale, type UsdEurRate } from '@/lib/money';

/**
 * Montant en dollars (la devise de facturation d'Anthropic), suivi de son équivalent indicatif en euros quand la
 * plateforme a fixé un taux. Sans taux utilisable, dollars seuls : jamais « NaN » ni « 0,00 € » (recette Q-2).
 */
export function Money({ usd, rate, className }: { usd: number; rate?: UsdEurRate | null; className?: string }) {
  const locale = useLocale() as MoneyLocale;
  const usable = usableRate(rate);
  return (
    <span className={className}>
      {formatUsd(usd, locale)}
      {usable && <span className="ml-1.5 text-[11.5px] font-normal text-muted-2">{formatEurApprox(usd, usable.rate, locale)}</span>}
    </span>
  );
}

/** Pourquoi les montants sont en dollars, et le taux de l'équivalent en euros s'il existe. */
export function MoneyNote({ rate, className }: { rate?: UsdEurRate | null; className?: string }) {
  const t = useTranslations('money');
  const locale = useLocale() as MoneyLocale;
  const usable = usableRate(rate);
  return (
    <p className={className ?? 'text-[11.5px] text-muted-2'}>
      {usable
        ? t('note', { rate: formatRate(usable.rate, locale), date: formatRateDate(usable.date, locale) })
        : t('noteDollars')}
    </p>
  );
}
