'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import type { Me, OrganizationSummary } from '@/lib/organizations';

interface MeResponse {
  user: Me;
  active_client_id: string | null;
}

export interface Session {
  me: Me;
  activeOrg: OrganizationSummary | null;
  isPlatformAdmin: boolean;
  isAdmin: boolean;
  readOnly: boolean;
  switchOrg(clientId: string): Promise<void>;
  refresh(): Promise<void>;
}

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: MeResponse };

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession doit être utilisé dans un SessionProvider.');
  return session;
}

/** Seule page de l'app accessible sans organisation. */
function isAccountPath(pathname: string): boolean {
  return pathname === '/account' || pathname.startsWith('/account/');
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (res.status === 401) {
        routerRef.current.replace('/login');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState({ status: 'ready', data: (await res.json()) as MeResponse });
    } catch (err) {
      console.error('[Session] chargement impossible', err);
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const switchOrg = useCallback(
    async (clientId: string): Promise<void> => {
      const res = await fetch('/api/auth/org', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      });
      if (res.ok) {
        // Rechargement complet : vide tout état client de l'organisation précédente.
        window.location.assign('/' + locale);
        return;
      }
      await load();
    },
    [load, locale],
  );

  const data = state.status === 'ready' ? state.data : null;
  const activeOrg = useMemo<OrganizationSummary | null>(
    () => data?.user.organizations.find((o) => o.client_id === data.active_client_id) ?? null,
    [data],
  );

  const session = useMemo<Session | null>(
    () =>
      data
        ? {
            me: data.user,
            activeOrg,
            isPlatformAdmin: data.user.role === 'super_admin',
            isAdmin: activeOrg?.role === 'admin',
            readOnly: activeOrg?.read_only === true,
            switchOrg,
            refresh: load,
          }
        : null,
    [data, activeOrg, switchOrg, load],
  );

  const needsOrganizationPage = session !== null && session.activeOrg === null && !isAccountPath(pathname);
  useEffect(() => {
    if (needsOrganizationPage) routerRef.current.replace('/no-organization');
  }, [needsOrganizationPage]);

  if (state.status === 'error') {
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
        <p className="text-muted">{t('error')}</p>
        <Button
          variant="outline"
          onClick={() => {
            setState({ status: 'loading' });
            void load();
          }}
        >
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (!session || needsOrganizationPage) return null;
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
