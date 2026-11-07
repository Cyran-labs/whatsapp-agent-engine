'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { AuthCard } from '@/components/auth/auth-card';

/** Session requise, mais hors du groupe (app) : aucun appel à l'API admin, donc pas de boucle de redirection. */
export default function NoOrganizationPage() {
  const t = useTranslations('noOrganization');
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
  }

  return (
    <AuthCard>
      <h1 className="font-serif text-[22px] font-normal leading-[1.2] text-fg">{t('title')}</h1>
      <p className="mt-1.5 text-[13px] text-muted">{t('body')}</p>
      <Link
        href="/account/preferences"
        className="mt-[18px] inline-flex w-full items-center justify-center rounded-md border border-transparent bg-accent px-4 py-[11px] text-sm font-bold text-accent-fg hover:bg-accent-hover"
      >
        {t('account')}
      </Link>
      <button
        type="button"
        onClick={() => void logout()}
        disabled={loggingOut}
        className="mt-2 inline-flex w-full items-center justify-center rounded-md border border-border-strong bg-surface px-4 py-[11px] text-sm text-fg hover:bg-bg disabled:opacity-50"
      >
        {t('logout')}
      </button>
    </AuthCard>
  );
}
