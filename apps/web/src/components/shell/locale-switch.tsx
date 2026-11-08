'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter, type routing } from '@/i18n/routing';
import { Segmented } from '@/components/account/segmented';

type Locale = (typeof routing.locales)[number];

const OPTIONS = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
];

export function LocaleSwitch() {
  const locale = useLocale();
  const t = useTranslations('locale');
  const pathname = usePathname();
  const router = useRouter();
  return (
    <Segmented
      ariaLabel={t('switch')}
      options={OPTIONS}
      value={locale}
      onChange={(next) => router.replace(pathname, { locale: next as Locale })}
    />
  );
}
