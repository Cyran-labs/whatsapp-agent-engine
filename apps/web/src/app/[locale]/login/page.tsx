import { useTranslations } from 'next-intl';
import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  const t = useTranslations('auth');
  return (
    <AuthCard>
      <h1 className="mb-[18px] font-serif text-[22px] font-normal leading-[1.2] text-fg">{t('loginTitle')}</h1>
      <LoginForm />
    </AuthCard>
  );
}
