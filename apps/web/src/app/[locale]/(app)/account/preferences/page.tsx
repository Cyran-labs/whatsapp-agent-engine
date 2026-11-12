'use client';

import { useTranslations } from 'next-intl';
import { LocaleSwitch } from '@/components/shell/locale-switch';
import { PageContent, PageHeader } from '@/components/shell/page-header';
import { ThemeToggle } from '@/components/shell/theme-toggle';

export default function PreferencesPage() {
  const t = useTranslations('account.preferences');
  const tLocale = useTranslations('locale');
  const tTheme = useTranslations('theme');

  return (
    <PageContent>
      <PageHeader title={t('title')} description={t('hint')} />
      <div className="max-w-[460px] rounded-xl border border-border bg-surface p-[18px] shadow-sm">
        <div className="mb-4">
          <div className="mb-1.5 text-[13px] font-semibold">{tLocale('switch')}</div>
          <LocaleSwitch />
        </div>
        <div>
          <div className="mb-1.5 text-[13px] font-semibold">{tTheme('label')}</div>
          <ThemeToggle />
        </div>
      </div>
    </PageContent>
  );
}
