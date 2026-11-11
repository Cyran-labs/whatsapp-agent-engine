'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { useNavigationGuard } from '@/components/shell/navigation-guard';
import { SessionUnreadable } from '@/components/shell/session-unreadable';
import { PageLoader } from '@/components/ui/page-loader';
import { bindApiFetch, type ApiFetchBinding } from '@/lib/api-fetch';
import { parseStoredOrgNotice, refusedNotice, reloadNotice, storedOrgNoticeValue, type OrgNotice, type StoredOrgNotice } from '@/lib/org-notice';
import { isOpenable, type Me, type OrganizationSummary } from '@/lib/organizations';
import { loginPathFor } from '@/lib/safe-next';
import { errorText } from '@/lib/error-text';

interface MeResponse {
  user: Me;
  active_client_id: string | null;
  /** Organisation enregistrée que le BFF a refusé d'ouvrir (listée et non ouvrable), sinon null (spec en-tête 7.2). */
  refused_client_id?: string | null;
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
   * Ouvre l'organisation : succès (la page se recharge) ; refus pour suspension, dit par le bandeau qui la nomme
   * (`suspended`, C-15) ; ou autre refus avec le message à montrer à l'endroit de l'action (« Impossible d'ouvrir
   * {org} : {raison}. »), avec la référence de la requête pour une panne serveur (audit R-14). Après un refus d'accès la
   * session est relue.
   */
  switchOrg(clientId: string): Promise<SwitchResult>;
  refresh(): Promise<void>;
}

export type SwitchResult =
  | { ok: true }
  | { ok: false; suspended: true }
  | { ok: false; suspended?: false; message: string; reference: string | null };

/** Référence de la requête d'une panne serveur (`error.request_id`), à citer au support ; null si absente ou illisible. */
async function requestIdOf(res: Response): Promise<string | null> {
  try {
    const id = ((await res.json()) as { error?: { request_id?: unknown } }).error?.request_id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/**
 * Lecture de la session. En échec, `last` est la dernière session lue par cet onglet (nulle au premier chargement) : son
 * cadre et sa liaison d'apiFetch restent, ses pages ne sont pas rendues (spec en-tête 7.3).
 */
type State =
  | { status: 'loading' }
  | { status: 'error'; last: MeResponse | null }
  | { status: 'ready'; data: MeResponse };

/** Session lue la plus récente de l'état : celle qui est prête, ou celle d'avant l'échec. */
function sessionOf(state: State): MeResponse | null {
  if (state.status === 'ready') return state.data;
  if (state.status === 'error') return state.last;
  return null;
}

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

/** Message pour le rechargement, gardé avec l'utilisateur de la session relue (revue isolation entête M-1). */
function storeNotice(notice: OrgNotice, userId: number): void {
  try {
    window.sessionStorage.setItem(NOTICE_STORAGE_KEY, storedOrgNoticeValue(notice, userId));
  } catch {
    // stockage indisponible : le message est perdu au rechargement, sans autre effet
  }
}

function clearStoredNotice(): void {
  try {
    window.sessionStorage.removeItem(NOTICE_STORAGE_KEY);
  } catch {
    // stockage indisponible : rien n'y a été gardé
  }
}

function takeStoredNotice(): StoredOrgNotice | null {
  try {
    const value = window.sessionStorage.getItem(NOTICE_STORAGE_KEY);
    window.sessionStorage.removeItem(NOTICE_STORAGE_KEY);
    return parseStoredOrgNotice(value);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const ts = useTranslations('shell.orgSwitcher');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [state, setState] = useState<State>({ status: 'loading' });
  const [notice, setNotice] = useState<OrgNotice | null>(null);
  // « Réessayer » d'une session illisible en cours : le bouton reste affiché, indisponible (D-109).
  const [retrying, setRetrying] = useState(false);
  const dataRef = useRef<MeResponse | null>(null);
  dataRef.current = sessionOf(state);
  const orgErrorRef = useRef(false);
  const orgChangedRef = useRef(false);
  const reloadingRef = useRef(false);
  const focusCheckRef = useRef(false);
  // Message relu du stockage au montage, montré seulement à la première session lue et si elle est de son utilisateur.
  const storedNoticeRef = useRef<StoredOrgNotice | null>(null);

  const { setGuard } = useNavigationGuard();
  /**
   * Rechargement complet sur l'accueil : vide tout état client de l'organisation précédente. Voulu (changement
   * d'organisation confirmé, ou fait dans un autre onglet) : la garde de sortie de l'assistant est levée avant, sinon
   * le navigateur le retiendrait (`beforeunload`, nav 15.4).
   */
  const reloadHome = useCallback(() => {
    setGuard(false);
    window.location.assign('/' + locale);
  }, [locale, setGuard]);

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

  /** Organisation enregistrée suspendue, une autre ouverte à sa place : le bandeau nomme celle qui a été tentée. */
  const showRefused = useCallback((data: MeResponse): void => {
    const refused = refusedNotice(data.refused_client_id ?? null, activeOrgOf(data), data.user.organizations);
    if (refused) setNotice(refused);
  }, []);

  /**
   * Session lue rendue. Utilisateur différent de la session déjà lue (autre compte connecté dans le même navigateur) :
   * le bandeau en état est vidé. Le bandeau stocké n'est montré qu'à la première session lue, de son utilisateur
   * (revue isolation entête M-1).
   */
  const accept = useCallback(
    (data: MeResponse): void => {
      const previous = dataRef.current;
      if (previous && previous.user.id !== data.user.id) setNotice(null);
      setState({ status: 'ready', data });
      const stored = storedNoticeRef.current;
      storedNoticeRef.current = null;
      if (stored && stored.userId === data.user.id) setNotice(stored.notice);
      showRefused(data);
    },
    [showRefused],
  );

  const load = useCallback(async (): Promise<MeResponse | null> => {
    try {
      const data = await readMe();
      if (data) accept(data);
      return data;
    } catch (err) {
      console.error('[Session] chargement impossible', errorText(err));
      setState((prev) => ({ status: 'error', last: sessionOf(prev) }));
      return null;
    }
  }, [readMe, accept]);

  /**
   * Rechargement complet parce que l'organisation affichée (`prev`, lue avant toute attente) n'est plus celle de la
   * session relue `next`. Seul point de décision du message (`reloadNotice`) : suspendue, accès perdu ou changée dans un
   * autre onglet ; toutes les voies y passent, la première qui arrive recharge et les autres sont sans effet. `prevUserId`
   * est l'utilisateur de la session affichée : si la session relue est celle d'un autre utilisateur, aucun message, qui
   * nommerait une organisation du précédent (revue isolation entête M-1).
   */
  const reloadChanged = useCallback(
    (next: MeResponse, prev: OrganizationSummary | null, prevUserId: number | null) => {
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      const notice = prevUserId === next.user.id ? reloadNotice(prev, activeOrgOf(next), next.user.organizations) : null;
      if (notice) storeNotice(notice, next.user.id);
      else clearStoredNotice();
      reloadHome();
    },
    [reloadHome],
  );

  /**
   * « Réessayer » d'une session illisible : relecture sans quitter l'écran. Même organisation active que la session déjà
   * lue (ou aucune session lue) : les pages sont rendues. Autre organisation (changée dans un autre onglet pendant la
   * panne) : rechargement complet, jamais l'ancien cadre avec la nouvelle organisation (point d'attention 5).
   */
  const retry = useCallback(async (): Promise<void> => {
    const last = dataRef.current;
    setRetrying(true);
    try {
      const next = await readMe();
      if (!next) return;
      const prev = last ? activeOrgOf(last) : null;
      if (last && (activeOrgOf(next)?.client_id ?? null) !== (prev?.client_id ?? null)) {
        reloadChanged(next, prev, last.user.id);
        return;
      }
      accept(next);
    } catch (err) {
      console.error('[Session] nouvel essai de lecture impossible', errorText(err));
    } finally {
      setRetrying(false);
    }
  }, [readMe, reloadChanged, accept]);

  /** Utilisateur de la session affichée par cet onglet, lu au moment de l'appel. */
  const displayedUserId = useCallback((): number | null => dataRef.current?.user.id ?? null, []);

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
    const prevUserId = displayedUserId();
    try {
      const next = await readMe();
      if (next) reloadChanged(next, prev, prevUserId);
    } catch (err) {
      console.error('[Session] relecture après changement d\'organisation impossible', errorText(err));
      reloadHome();
    }
  }, [displayedOrg, displayedUserId, readMe, reloadChanged, reloadHome]);

  useEffect(() => {
    void load();
    // Mode strict : l'effet s'exécute deux fois, la clé n'est lisible qu'une fois. Ne jamais écraser par null.
    const stored = takeStoredNotice();
    if (stored) storedNoticeRef.current = stored;
  }, [load]);

  /**
   * Erreur d'organisation renvoyée par une route d'administration : la session est relue.
   * Organisation active changée (dont l'organisation affichée devenue suspendue) : rechargement, le message suit via
   * sessionStorage. Plus aucune organisation : la garde mène à /no-organization. Même organisation, toujours ouvrable :
   * message seulement si le rôle a changé (une 403 de rôle seule ne change rien), jamais « suspendue » pour une
   * organisation qui s'ouvre (recette 3.13).
   */
  const handleOrgError = useCallback(
    async (): Promise<void> => {
      if (orgErrorRef.current) return;
      orgErrorRef.current = true;
      try {
        const before = displayedOrg();
        const beforeUserId = displayedUserId();
        const next = await readMe();
        if (!next) return;
        const after = activeOrgOf(next);
        if (after && after.client_id !== before?.client_id) {
          reloadChanged(next, before, beforeUserId);
          return;
        }
        accept(next);
        // Rôle comparé seulement pour le même utilisateur : celui d'un autre compte n'a pas « changé ».
        const roleChanged =
          after !== null && beforeUserId === next.user.id && (after.role !== before?.role || after.read_only !== before?.read_only);
        if (after && roleChanged) setNotice({ kind: 'access', org: after.name, role: after.role, readOnly: after.read_only });
      } catch (err) {
        console.error('[Session] relecture après erreur d\'organisation impossible', errorText(err));
      } finally {
        orgErrorRef.current = false;
      }
    },
    [accept, displayedOrg, displayedUserId, readMe, reloadChanged],
  );

  // Retour sur l'onglet : une bascule faite dans un autre onglet (cookie partagé) recharge celui-ci, comme une session
  // d'un autre utilisateur, même sur la même organisation (revue isolation entête M-1).
  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready) return;
    async function check(): Promise<void> {
      if (document.visibilityState === 'hidden' || focusCheckRef.current) return;
      focusCheckRef.current = true;
      try {
        const prev = displayedOrg();
        const prevUserId = displayedUserId();
        const next = await readMe();
        if (next && (next.active_client_id !== (dataRef.current?.active_client_id ?? null) || next.user.id !== prevUserId)) {
          reloadChanged(next, prev, prevUserId);
        }
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
  }, [ready, displayedOrg, displayedUserId, readMe, reloadChanged]);

  const switchOrg = useCallback(
    async (clientId: string): Promise<SwitchResult> => {
      const prev = displayedOrg();
      const prevUserId = displayedUserId();
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
      if (next.active_client_id !== (prev?.client_id ?? null)) reloadChanged(next, prev, prevUserId);
      const now = next.user.organizations.find((o) => o.client_id === clientId);
      if (now && !isOpenable(now)) {
        // Organisation tentée suspendue : le bandeau la nomme (C-15), le menu se ferme, rien n'est dit deux fois.
        setNotice({ kind: 'suspended', org: now.name, role: now.role });
        return { ok: false, suspended: true };
      }
      return refused(ts('reasonLost'));
    },
    [displayedOrg, displayedUserId, load, reloadChanged, reloadHome, ts],
  );

  const refresh = useCallback(async (): Promise<void> => {
    await load();
  }, [load]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const data = sessionOf(state);
  const activeOrg = useMemo<OrganizationSummary | null>(() => (data ? activeOrgOf(data) : null), [data]);

  // Liaison d'apiFetch posée pendant le rendu : les effets des enfants (premiers appels) passent avant ceux du parent.
  const apiBinding: ApiFetchBinding | null = data
    ? {
        displayedOrg: data.active_client_id,
        onOrgChanged: () => void handleOrgChanged(),
        // Les deux genres (accès, suspendue) relisent la session : elle seule dit ce qui a changé.
        onOrgError: () => void handleOrgError(),
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

  const needsOrganizationPage = state.status === 'ready' && session !== null && session.activeOrg === null && !isAccountPath(pathname);
  useEffect(() => {
    if (needsOrganizationPage) routerRef.current.replace('/no-organization');
  }, [needsOrganizationPage]);

  if (state.status === 'error') {
    // Session illisible sur place (C-8) : cadre de la session déjà lue, ou cadre neutre sans aucune donnée d'organisation.
    const unreadable = <SessionUnreadable frame={session ? 'session' : 'neutral'} onRetry={() => void retry()} retrying={retrying} />;
    return session ? <SessionContext.Provider value={session}>{unreadable}</SessionContext.Provider> : unreadable;
  }
  // Session en cours de chargement ou redirection vers /no-organization : rien à montrer encore.
  if (!session || needsOrganizationPage) return <PageLoader fullScreen />;
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
