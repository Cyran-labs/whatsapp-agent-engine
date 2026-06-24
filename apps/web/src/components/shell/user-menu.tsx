'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function UserMenu() {
  const t = useTranslations('auth');
  const router = useRouter();

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // best-effort : on redirige vers login quoi qu'il arrive
    }
    router.push('/login');
  }

  return (
    <Button variant="ghost" size="sm" onClick={logout} aria-label={t('logout')}>
      <LogOut className="h-4 w-4" />
      {t('logout')}
    </Button>
  );
}
