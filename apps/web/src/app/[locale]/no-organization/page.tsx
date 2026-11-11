'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { AuthCard } from '@/components/auth/auth-card';
import { suspendedOrganizations, type Me, type OrganizationSummary } from '@/lib/organizations';
import { errorText } from '@/lib/error-text';
import { loginPathFor } from '@/lib/safe-next';

/** Lecture de la session : en cours, en échec (message distinct, prototype 13), ou ses organisations suspendues. */
type SessionRead =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; suspended: OrganizationSummary[] };

/**
 * Session requise, mais hors du groupe (app) : aucun appel à l'API admin, donc pas de boucle de redirection.
 * Seule la session est lue, pour dire si l'absence d'organisation tient à une suspension (audit R-13) : les organisations
 * suspendues du membre sont nommées, sans parler d'invitation. Le paragraphe n'est affiché qu'une fois la lecture finie
 * (le texte général, invitation comprise, ne passe donc jamais à l'écran d'un membre suspendu). Lecture impossible :
 * message distinct et « Réessayer », jamais le texte « aucune organisation » (prototype 13) ; session perdue (401) :
 * retour à la connexion. Admin de toutes ses organisations suspendues : il n'a pas d'administrateur à contacter,
 * seul le support est proposé.
 */
export default function NoOrganizationPage() {
  const t = useTranslations('noOrganization');
  const tc = useTranslations('common');
  // même phrase que la session illisible de l'app (spec en-tête 3.1), une seule clé
  const ts = useTranslations('shell.sessionUnreadable');
  const locale = useLocale();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [session, setSession] = useState<SessionRead>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // relecture demandée par « Réessayer » : l'erreur et son bouton restent affichés (focus gardé) jusqu'à la réponse
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function readSession(): Promise<void> {
      let next: SessionRead = { status: 'error' };
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (res.status === 401) {
          // session perdue : retour à la connexion, comme le reste de l'app (session-provider), sans message d'erreur
          if (!cancelled) router.replace(loginPathFor(window.location.pathname + window.location.search));
          return;
        }
        if (res.ok) {
          const { user } = (await res.json()) as { user: Me };
          next = { status: 'ready', suspended: suspendedOrganizations(user.organizations) };
        } else {
          console.error('[NoOrganization] lecture de la session refusée', res.status);
        }
      } catch (err) {
        console.error('[NoOrganization] lecture de la session impossible', errorText(err));
      }
      if (!cancelled) {
        setSession(next);
        setRetrying(false);
      }
    }
    void readSession();
    return () => {
      cancelled = true;
    };
    // seul un nouvel essai relance la lecture (le routeur ne change pas en cours de route)
  }, [attempt]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
  }

  return (
    <AuthCard>
      <h1 className="font-serif text-[22px] font-normal leading-[1.2] text-fg">{t('title')}</h1>
      {session.status === 'error' && (
        <div className="mt-1.5">
          <p role="alert" className="text-[13px] text-danger">
            {ts('title')}
          </p>
          <button
            type="button"
            aria-disabled={retrying || undefined}
            onClick={() => {
              if (retrying) return;
              setRetrying(true);
              setAttempt((n) => n + 1);
            }}
            className="mt-2 text-[13px] font-semibold text-accent-ink hover:underline aria-disabled:cursor-default aria-disabled:text-muted-2 aria-disabled:no-underline"
          >
            {retrying ? tc('retrying') : tc('retry')}
          </button>
        </div>
      )}
      {session.status === 'ready' && (
        <p className="mt-1.5 text-[13px] text-muted">
          {session.suspended.length > 0
            ? t('suspendedBody', {
                count: session.suspended.length,
                names: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
                  session.suspended.map((o) => o.name),
                ),
                contact: session.suspended.every((o) => o.role === 'admin') ? 'support' : 'admin',
              })
            : t('body')}
        </p>
      )}
      <Link
        href="/account/organisations"
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
