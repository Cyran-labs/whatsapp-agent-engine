'use client';

import { useTranslations } from 'next-intl';
import { ChangePasswordForm } from '@/components/account/change-password-form';
import { PageBar } from '@/components/shell/page-bar';

export default function SecurityPage() {
  const t = useTranslations('account.security');

  return (
    <>
      <PageBar root="account" trail={[{ label: t('title') }]} />
      <div className="px-8 py-7">
        <div className="mb-[18px]">
          <h1 className="font-serif text-[26px] font-normal leading-[1.1]">{t('title')}</h1>
        </div>
        <ChangePasswordForm />
      </div>
    </>
  );
}
