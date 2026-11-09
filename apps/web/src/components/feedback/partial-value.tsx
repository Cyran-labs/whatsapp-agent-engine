'use client';

import { useTranslations } from 'next-intl';

/** Chiffre inconnu (lecture en échec) : « indisponible » à la place de la valeur, jamais 0 (audit §5.1, R-3). */
export function PartialValue() {
  const t = useTranslations('common');
  return <span className="text-muted">{t('unavailable')}</span>;
}
