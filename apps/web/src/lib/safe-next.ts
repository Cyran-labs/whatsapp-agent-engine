import { routing } from '../i18n/routing';
import { decodedSegments, isPublicSegment } from './public-routes';

/** Hôte fictif pour résoudre un chemin comme le navigateur (jamais utilisé comme destination). */
const BASE = 'http://n.invalid';

const isLocale = (segment: string | undefined): boolean => (routing.locales as readonly string[]).includes(segment ?? '');

/**
 * Chemin de retour après connexion (`?next=`) : un chemin interne seulement. Refuse tout ce qui peut mener hors du
 * site (URL absolue, `//hôte`, barre oblique inverse, caractère de contrôle que le navigateur avale), les routes
 * d'API et les pages publiques d'authentification (connexion, mot de passe oublié, invitation : une adresse forgée
 * ne ramène pas un utilisateur connecté sur la connexion). Le contrôle porte sur le chemin normalisé, tel que le
 * navigateur le résout (`/fr/../api/x` et `/%2e%2e/api/x` donnent `/api/x`) ; le chemin normalisé est celui rendu.
 * Une valeur refusée donne null : l'appelant retombe sur l'accueil.
 */
export function safeNext(raw: string | null): string | null {
  if (raw === null || !raw.startsWith('/') || raw.startsWith('//')) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  const { pathname } = url;
  if (url.origin !== BASE || pathname.startsWith('//')) return null;
  if (pathname === '/api' || pathname.startsWith('/api/')) return null;
  // Next décode les segments avant d'acheminer : la langue et les pages publiques se comparent décodées.
  const segments = decodedSegments(pathname);
  if (segments === null) return null;
  const first = isLocale(segments[0]) ? segments[1] : segments[0];
  if (isPublicSegment(first)) return null;
  return pathname + url.search + url.hash;
}

/**
 * Sépare le préfixe de langue d'un chemin sûr (`/fr/agents?x=1` donne `fr` et `/agents?x=1`) : le routeur de
 * l'interface ajoute lui-même la langue, pousser le chemin complet la doublerait.
 */
export function splitLocale<L extends string>(path: string, locales: readonly L[]): { locale: L | null; path: string } {
  for (const locale of locales) {
    const prefix = `/${locale}`;
    if (path === prefix) return { locale, path: '/' };
    const next = path.slice(prefix.length, prefix.length + 1);
    if (path.startsWith(prefix) && (next === '/' || next === '?' || next === '#')) {
      const rest = path.slice(prefix.length);
      return { locale, path: rest.startsWith('/') ? rest : `/${rest}` };
    }
  }
  return { locale: null, path };
}

/**
 * Adresse de la connexion après une session expirée, sans langue (le routeur l'ajoute) : la raison et, si
 * le chemin actuel est sûr (la connexion elle-même ne l'est pas), le chemin où revenir.
 */
export function loginPathFor(currentPath: string): string {
  const next = safeNext(currentPath);
  return next === null ? '/login?reason=session' : `/login?reason=session&next=${encodeURIComponent(next)}`;
}
