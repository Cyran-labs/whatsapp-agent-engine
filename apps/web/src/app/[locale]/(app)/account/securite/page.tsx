'use client';

import { useTranslations } from 'next-intl';
import { ChangePasswordForm } from '@/components/account/change-password-form';
import { PageContent, PageHeader } from '@/components/shell/page-header';

export default function SecurityPage() {
  const t = useTranslations('account.security');

  return (
    <PageContent>
      <PageHeader title={t('title')} />
      <ChangePasswordForm />
    </PageContent>
  );
}
