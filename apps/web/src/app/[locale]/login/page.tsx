import { useTranslations } from 'next-intl';
import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  const t = useTranslations('auth');
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-sm">
        <h1 className="mb-6 font-serif text-2xl text-fg">{t('loginTitle')}</h1>
        <LoginForm />
      </div>
    </main>
  );
}
