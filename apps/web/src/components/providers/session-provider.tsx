'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import { bindApiFetch, type ApiFetchBinding, type OrgNoticeKind } from '@/lib/api-fetch';
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
  /** Message d'information après une erreur d'organisation, affiché par OrgNoticeBanner. */
  notice: OrgNoticeKind | null;
  dismissNotice(): void;
  switchOrg(clientId: string): Promise<void>;
  refresh(): Promise<void>;
}

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: MeResponse };

const SessionContext = createContext<Session | null>(null);

/** Message à afficher après le rechargement qui suit une erreur d'organisation. */
const NOTICE_STORAGE_KEY = 'wab_org_notice';

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession doit être utilisé dans un SessionProvider.');
  return session;
}

/** Seule page de l'app accessible sans organisation. */
function isAccountPath(pathname: string): boolean {
  return pathname === '/account' || pathname.startsWith('/account/');
}

function activeOrgOf(data: MeResponse): OrganizationSummary | null {
  return data.user.organizations.find((o) => o.client_id === data.active_client_id) ?? null;
}

function storeNotice(kind: OrgNoticeKind): void {
  try {
    window.sessionStorage.setItem(NOTICE_STORAGE_KEY, kind);
  } catch {
    // stockage indisponible : le message est perdu au rechargement, sans autre effet
  }
}

function takeStoredNotice(): OrgNoticeKind | null {
  try {
    const value = window.sessionStorage.getItem(NOTICE_STORAGE_KEY);
    window.sessionStorage.removeItem(NOTICE_STORAGE_KEY);
    return value === 'access' || value === 'suspended' ? value : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [state, setState] = useState<State>({ status: 'loading' });
  const [notice, setNotice] = useState<OrgNoticeKind | null>(null);
  const dataRef = useRef<MeResponse | null>(null);
  dataRef.current = state.status === 'ready' ? state.data : null;
  const orgErrorRef = useRef(false);
  const focusCheckRef = useRef(false);

  /** Rechargement complet sur l'accueil : vide tout état client de l'organisation précédente. */
  const reloadHome = useCallback(() => {
    window.location.assign('/' + locale);
  }, [locale]);

  /** Relit /api/auth/me ; null si la session est perdue (redirection faite) ou la lecture impossible. */
  const readMe = useCallback(async (): Promise<MeResponse | null> => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (res.status === 401) {
      routerRef.current.replace('/login');
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as MeResponse;
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await readMe();
      if (data) setState({ status: 'ready', data });
    } catch (err) {
      console.error('[Session] chargement impossible', err);
      setState({ status: 'error' });
    }
  }, [readMe]);

  useEffect(() => {
    void load();
    // Mode strict : l'effet s'exécute deux fois, la clé n'est lisible qu'une fois. Ne jamais écraser par null.
    const stored = takeStoredNotice();
    if (stored) setNotice(stored);
  }, [load]);

  /**
   * Erreur d'organisation renvoyée par une route d'administration : la session est relue.
   * Organisation active changée : rechargement, le message suit via sessionStorage. Plus aucune
   * organisation : la garde mène à /no-organization. Même organisation : message seulement si
   * le rôle a changé (une 403 de rôle seule ne change rien) ou si l'organisation est suspendue.
   */
  const handleOrgError = useCallback(
    async (kind: OrgNoticeKind): Promise<void> => {
      if (orgErrorRef.current) return;
      orgErrorRef.current = true;
      try {
        const before = dataRef.current ? activeOrgOf(dataRef.current) : null;
        const next = await readMe();
        if (!next) return;
        const after = activeOrgOf(next);
        if (after && after.client_id !== before?.client_id) {
          storeNotice(kind);
          reloadHome();
          return;
        }
        setState({ status: 'ready', data: next });
        const roleChanged = after !== null && (after.role !== before?.role || after.read_only !== before?.read_only);
        if (after && (kind === 'suspended' || roleChanged)) setNotice(kind);
      } catch (err) {
        console.error('[Session] relecture après erreur d\'organisation impossible', err);
      } finally {
        orgErrorRef.current = false;
      }
    },
    [readMe, reloadHome],
  );

  // Retour sur l'onglet : une bascule faite dans un autre onglet (cookie partagé) recharge celui-ci.
  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready) return;
    async function check(): Promise<void> {
      if (document.visibilityState === 'hidden' || focusCheckRef.current) return;
      focusCheckRef.current = true;
      try {
        const next = await readMe();
        if (next && next.active_client_id !== (dataRef.current?.active_client_id ?? null)) reloadHome();
      } catch (err) {
        console.error('[Session] vérification de l\'organisation impossible', err);
      } finally {
        focusCheckRef.current = false;
      }
    }
    const onChange = () => void check();
    window.addEventListener('focus', onChange);
    document.addEventListener('visibilitychange', onChange);
    return () => {
      window.removeEventListener('focus', onChange);
      document.removeEventListener('visibilitychange', onChange);
    };
  }, [ready, readMe, reloadHome]);

  const switchOrg = useCallback(
    async (clientId: string): Promise<void> => {
      const res = await fetch('/api/auth/org', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      });
      if (res.ok) {
        reloadHome();
        return;
      }
      await load();
    },
    [load, reloadHome],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  const data = state.status === 'ready' ? state.data : null;
  const activeOrg = useMemo<OrganizationSummary | null>(() => (data ? activeOrgOf(data) : null), [data]);

  // Liaison d'apiFetch posée pendant le rendu : les effets des enfants (premiers appels) passent avant ceux du parent.
  const apiBinding: ApiFetchBinding | null = data
    ? {
        displayedOrg: data.active_client_id,
        onOrgChanged: reloadHome,
        onOrgError: (kind) => void handleOrgError(kind),
        onUnauthorized: () => routerRef.current.replace('/login'),
      }
    : null;
  bindApiFetch(apiBinding);
  const apiBindingRef = useRef(apiBinding);
  apiBindingRef.current = apiBinding;
  // Reposée au montage (double montage du mode strict), retirée au démontage.
  useEffect(() => {
    bindApiFetch(apiBindingRef.current);
    return () => bindApiFetch(null);
  }, []);

  const session = useMemo<Session | null>(
    () =>
      data
        ? {
            me: data.user,
            activeOrg,
            isPlatformAdmin: data.user.role === 'super_admin',
            isAdmin: activeOrg?.role === 'admin',
            readOnly: activeOrg?.read_only === true,
            notice,
            dismissNotice,
            switchOrg,
            refresh: load,
          }
        : null,
    [data, activeOrg, notice, dismissNotice, switchOrg, load],
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
  // Session en cours de chargement ou redirection vers /no-organization : rien à montrer encore.
  if (!session || needsOrganizationPage) return <PageLoader fullScreen />;
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
