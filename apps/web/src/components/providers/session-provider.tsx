'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import { bindApiFetch, type ApiFetchBinding, type OrgErrorKind } from '@/lib/api-fetch';
import { parseOrgNotice, reloadNotice, type OrgNotice } from '@/lib/org-notice';
import { isOpenable, type Me, type OrganizationSummary } from '@/lib/organizations';
import { loginPathFor } from '@/lib/safe-next';
import { errorText } from '@/lib/error-text';

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
  /** Message d'information après un événement d'organisation, affiché par OrgNoticeBanner. */
  notice: OrgNotice | null;
  dismissNotice(): void;
  /**
   * Ouvre l'organisation : succès (la page se recharge), ou refus avec le message à montrer à l'endroit de l'action
   * (« Impossible d'ouvrir {org} : {raison}. »), avec la référence de la requête pour une panne serveur (audit R-14).
   * Après un refus d'accès la session est relue.
   */
  switchOrg(clientId: string): Promise<SwitchResult>;
  refresh(): Promise<void>;
}

export type SwitchResult = { ok: true } | { ok: false; message: string; reference: string | null };

/** Référence de la requête d'une panne serveur (`error.request_id`), à citer au support ; null si absente ou illisible. */
async function requestIdOf(res: Response): Promise<string | null> {
  try {
    const id = ((await res.json()) as { error?: { request_id?: unknown } }).error?.request_id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
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

/** Session perdue : connexion avec la raison et le chemin actuel (langue et requête comprises) pour y revenir (audit R-10). */
function loginAfterExpiry(): string {
  return loginPathFor(window.location.pathname + window.location.search);
}

/** Seule page de l'app accessible sans organisation. */
function isAccountPath(pathname: string): boolean {
  return pathname === '/account' || pathname.startsWith('/account/');
}

function activeOrgOf(data: MeResponse): OrganizationSummary | null {
  return data.user.organizations.find((o) => o.client_id === data.active_client_id) ?? null;
}

function storeNotice(notice: OrgNotice): void {
  try {
    window.sessionStorage.setItem(NOTICE_STORAGE_KEY, JSON.stringify(notice));
  } catch {
    // stockage indisponible : le message est perdu au rechargement, sans autre effet
  }
}

function takeStoredNotice(): OrgNotice | null {
  try {
    const value = window.sessionStorage.getItem(NOTICE_STORAGE_KEY);
    window.sessionStorage.removeItem(NOTICE_STORAGE_KEY);
    return parseOrgNotice(value);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  const ts = useTranslations('shell.orgSwitcher');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [state, setState] = useState<State>({ status: 'loading' });
  const [notice, setNotice] = useState<OrgNotice | null>(null);
  const dataRef = useRef<MeResponse | null>(null);
  dataRef.current = state.status === 'ready' ? state.data : null;
  const orgErrorRef = useRef(false);
  const orgChangedRef = useRef(false);
  const reloadingRef = useRef(false);
  const focusCheckRef = useRef(false);

  /** Rechargement complet sur l'accueil : vide tout état client de l'organisation précédente. */
  const reloadHome = useCallback(() => {
    window.location.assign('/' + locale);
  }, [locale]);

  /** Relit /api/auth/me ; null si la session est perdue (redirection faite) ou la lecture impossible. */
  const readMe = useCallback(async (): Promise<MeResponse | null> => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (res.status === 401) {
      routerRef.current.replace(loginAfterExpiry());
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as MeResponse;
  }, []);

  const load = useCallback(async (): Promise<MeResponse | null> => {
    try {
      const data = await readMe();
      if (data) setState({ status: 'ready', data });
      return data;
    } catch (err) {
      console.error('[Session] chargement impossible', errorText(err));
      setState({ status: 'error' });
      return null;
    }
  }, [readMe]);

  /**
   * Rechargement complet parce que l'organisation affichée (`prev`, lue avant toute attente) n'est plus celle de la
   * session relue `next`. Seul point de décision du message (`reloadNotice`) : suspendue, accès perdu ou changée dans un
   * autre onglet ; toutes les voies y passent, la première qui arrive recharge et les autres sont sans effet.
   */
  const reloadChanged = useCallback(
    (next: MeResponse, prev: OrganizationSummary | null) => {
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      const notice = reloadNotice(prev, activeOrgOf(next), next.user.organizations);
      if (notice) storeNotice(notice);
      reloadHome();
    },
    [reloadHome],
  );

  /** Organisation affichée par cet onglet, lue dans la session au moment de l'appel. */
  const displayedOrg = useCallback(
    (): OrganizationSummary | null => (dataRef.current ? activeOrgOf(dataRef.current) : null),
    [],
  );

  /** 409 ORG_CHANGED : la session est relue pour nommer la nouvelle organisation ; relecture impossible : rechargement seul. */
  const handleOrgChanged = useCallback(async (): Promise<void> => {
    if (orgChangedRef.current) return;
    orgChangedRef.current = true;
    const prev = displayedOrg();
    try {
      const next = await readMe();
      if (next) reloadChanged(next, prev);
    } catch (err) {
      console.error('[Session] relecture après changement d\'organisation impossible', errorText(err));
      reloadHome();
    }
  }, [displayedOrg, readMe, reloadChanged, reloadHome]);

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
    async (kind: OrgErrorKind): Promise<void> => {
      if (orgErrorRef.current) return;
      orgErrorRef.current = true;
      try {
        const before = displayedOrg();
        const next = await readMe();
        if (!next) return;
        const after = activeOrgOf(next);
        if (after && after.client_id !== before?.client_id) {
          reloadChanged(next, before);
          return;
        }
        setState({ status: 'ready', data: next });
        const roleChanged = after !== null && (after.role !== before?.role || after.read_only !== before?.read_only);
        if (after && kind === 'suspended') setNotice({ kind, org: after.name });
        else if (after && roleChanged) setNotice({ kind, org: after.name, role: after.role, readOnly: after.read_only });
      } catch (err) {
        console.error('[Session] relecture après erreur d\'organisation impossible', errorText(err));
      } finally {
        orgErrorRef.current = false;
      }
    },
    [displayedOrg, readMe, reloadChanged],
  );

  // Retour sur l'onglet : une bascule faite dans un autre onglet (cookie partagé) recharge celui-ci.
  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready) return;
    async function check(): Promise<void> {
      if (document.visibilityState === 'hidden' || focusCheckRef.current) return;
      focusCheckRef.current = true;
      try {
        const prev = displayedOrg();
        const next = await readMe();
        if (next && next.active_client_id !== (dataRef.current?.active_client_id ?? null)) reloadChanged(next, prev);
      } catch (err) {
        console.error('[Session] vérification de l\'organisation impossible', errorText(err));
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
  }, [ready, displayedOrg, readMe, reloadChanged]);

  const switchOrg = useCallback(
    async (clientId: string): Promise<SwitchResult> => {
      const prev = displayedOrg();
      const named = dataRef.current?.user.organizations.find((o) => o.client_id === clientId)?.name;
      const org = named ?? ts('thisOrganization');
      const refused = (reason: string, reference: string | null = null): SwitchResult => ({
        ok: false,
        message: ts('openFailed', { org, reason }),
        reference,
      });
      let res: Response;
      try {
        res = await fetch('/api/auth/org', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ client_id: clientId }),
        });
      } catch (err) {
        console.error('[Session] changement d\'organisation impossible', errorText(err));
        return refused(ts('reasonNetwork'));
      }
      if (res.ok) {
        reloadHome();
        return { ok: true };
      }
      if (res.status === 401) {
        routerRef.current.replace(loginAfterExpiry());
        return refused(ts('reasonFailed'));
      }
      if (res.status === 429) return refused(ts('reasonRateLimited'));
      if (res.status >= 500) return refused(ts('reasonFailed'), await requestIdOf(res));
      if (res.status !== 403 && res.status !== 404) return refused(ts('reasonFailed'));
      // Refus d'accès : la session est relue, elle dit si l'organisation est suspendue ou n'est plus accessible.
      const next = await load();
      if (!next) return refused(ts('reasonFailed'));
      // La session relue affiche une autre organisation que cet onglet : même décision et rechargement, pas un nom mis à jour sous l'ancienne page.
      if (next.active_client_id !== (prev?.client_id ?? null)) reloadChanged(next, prev);
      const now = next.user.organizations.find((o) => o.client_id === clientId);
      return refused(ts(now && !isOpenable(now) ? 'reasonSuspended' : 'reasonLost'));
    },
    [displayedOrg, load, reloadChanged, reloadHome, ts],
  );

  const refresh = useCallback(async (): Promise<void> => {
    await load();
  }, [load]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const data = state.status === 'ready' ? state.data : null;
  const activeOrg = useMemo<OrganizationSummary | null>(() => (data ? activeOrgOf(data) : null), [data]);

  // Liaison d'apiFetch posée pendant le rendu : les effets des enfants (premiers appels) passent avant ceux du parent.
  const apiBinding: ApiFetchBinding | null = data
    ? {
        displayedOrg: data.active_client_id,
        onOrgChanged: () => void handleOrgChanged(),
        onOrgError: (kind) => void handleOrgError(kind),
        onUnauthorized: () => routerRef.current.replace(loginAfterExpiry()),
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
            refresh,
          }
        : null,
    [data, activeOrg, notice, dismissNotice, switchOrg, refresh],
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
