import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const t = await getTranslations('auth');
  const { reset } = await searchParams;
  return (
    <AuthCard>
      <h1 className="mb-[18px] font-serif text-[22px] font-normal leading-[1.2] text-fg">{t('loginTitle')}</h1>
      {reset === '1' && (
        <div role="status" className="mb-3.5 rounded-lg border border-[#BBE7C8] bg-success-soft px-[13px] py-[11px] text-[13px] text-success-ink">
          {t('reset.done')}
        </div>
      )}
      <LoginForm forgotHref="/forgot-password" />
    </AuthCard>
  );
}
