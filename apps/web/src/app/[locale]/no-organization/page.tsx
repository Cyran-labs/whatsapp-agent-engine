'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { AuthCard } from '@/components/auth/auth-card';
import { suspendedOrganizations, type Me } from '@/lib/organizations';

/**
 * Session requise, mais hors du groupe (app) : aucun appel à l'API admin, donc pas de boucle de redirection.
 * Seule la session est lue, pour dire si l'absence d'organisation tient à une suspension (audit R-13) : les organisations
 * suspendues du membre sont nommées, sans parler d'invitation. Lecture impossible : le texte général reste.
 */
export default function NoOrganizationPage() {
  const t = useTranslations('noOrganization');
  const locale = useLocale();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [suspended, setSuspended] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function read(): Promise<void> {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!res.ok) return;
        const { user } = (await res.json()) as { user: Me };
        if (!cancelled) setSuspended(suspendedOrganizations(user.organizations).map((o) => o.name));
      } catch (err) {
        console.error('[NoOrganization] lecture de la session impossible', err);
      }
    }
    void read();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
  }

  return (
    <AuthCard>
      <h1 className="font-serif text-[22px] font-normal leading-[1.2] text-fg">{t('title')}</h1>
      <p className="mt-1.5 text-[13px] text-muted">
        {suspended.length > 0
          ? t('suspendedBody', {
              count: suspended.length,
              names: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(suspended),
            })
          : t('body')}
      </p>
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
