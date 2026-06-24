'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';

const LOCALES = ['fr', 'en'] as const;

export function LocaleSwitch() {
  const locale = useLocale();
  const t = useTranslations('locale');
  const pathname = usePathname();
  const router = useRouter();
  return (
    <select
      aria-label={t('switch')}
      value={locale}
      onChange={(e) => router.replace(pathname, { locale: e.target.value as 'fr' | 'en' })}
      className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg"
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>{l.toUpperCase()}</option>
      ))}
    </select>
  );
}
