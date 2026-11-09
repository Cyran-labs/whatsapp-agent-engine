/**
 * Chemin de retour après connexion (`?next=`) : un chemin interne seulement. Refuse tout ce qui peut mener hors du
 * site (URL absolue, `//hôte`, barre oblique inverse, caractère de contrôle que le navigateur avale) et les routes
 * d'API. Une valeur refusée donne null : l'appelant retombe sur l'accueil.
 */
export function safeNext(raw: string | null): string | null {
  if (raw === null || !raw.startsWith('/') || raw.startsWith('//')) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  const path = raw.split(/[?#]/, 1)[0];
  if (path === '/api' || path.startsWith('/api/')) return null;
  return raw;
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
 * le chemin actuel est sûr et n'est pas déjà la connexion, le chemin où revenir.
 */
export function loginPathFor(currentPath: string): string {
  const next = safeNext(currentPath);
  const onLogin = next !== null && /^\/(?:[a-z]{2}\/)?login(?:[?#]|$)/.test(next);
  return next === null || onLogin
    ? '/login?reason=session'
    : `/login?reason=session&next=${encodeURIComponent(next)}`;
}
