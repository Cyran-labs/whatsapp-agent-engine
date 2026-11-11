'use client';

import { useTranslations } from 'next-intl';
import { LocaleSwitch } from '@/components/shell/locale-switch';
import { PageBar } from '@/components/shell/page-bar';
import { ThemeToggle } from '@/components/shell/theme-toggle';

export default function PreferencesPage() {
  const t = useTranslations('account.preferences');
  const tLocale = useTranslations('locale');
  const tTheme = useTranslations('theme');

  return (
    <>
      <PageBar root="account" trail={[{ label: t('title') }]} />
      <div className="px-8 py-7">
        <div className="mb-[18px]">
          <h1 className="font-serif text-[26px] font-normal leading-[1.1]">{t('title')}</h1>
        </div>
        <div className="max-w-[460px] rounded-xl border border-border bg-surface p-[18px] shadow-sm">
          <div className="mb-4">
            <div className="mb-1.5 text-[13px] font-semibold">{tLocale('switch')}</div>
            <LocaleSwitch />
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-semibold">{tTheme('label')}</div>
            <ThemeToggle />
            <div className="mt-[5px] text-[11.5px] text-muted-2">{t('hint')}</div>
          </div>
        </div>
      </div>
    </>
  );
}
