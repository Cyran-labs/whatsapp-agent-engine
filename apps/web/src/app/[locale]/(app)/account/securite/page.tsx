'use client';

import { useTranslations } from 'next-intl';
import { ChangePasswordForm } from '@/components/account/change-password-form';

export default function SecurityPage() {
  const t = useTranslations('account.security');

  return (
    <>
      <div className="mb-[18px]">
        <h1 className="font-serif text-[26px] font-normal leading-[1.1]">{t('title')}</h1>
      </div>
      <ChangePasswordForm />
    </>
  );
}
