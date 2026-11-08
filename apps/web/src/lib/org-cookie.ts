/**
 * Cookie wab_org : dernière organisation utilisée sur ce navigateur, au format `<user_id>:<client_id>`.
 * Il survit à la déconnexion, mais seul l'utilisateur qui l'a posé reprend l'organisation ;
 * un autre compte (ou un ancien cookie au format nu) le voit comme absent.
 */
export function encodeOrgCookie(userId: number | string, clientId: string): string {
  return `${String(userId)}:${clientId}`;
}

/** Organisation du cookie si elle appartient à `userId`, sinon undefined. */
export function orgOfUser(raw: string | undefined, userId: number | string | undefined): string | undefined {
  if (raw === undefined || userId === undefined) return undefined;
  const separator = raw.indexOf(':');
  if (separator <= 0) return undefined;
  const owner = raw.slice(0, separator);
  const clientId = raw.slice(separator + 1);
  if (owner !== String(userId) || clientId.length === 0) return undefined;
  return clientId;
}

/**
 * Sujet (identifiant utilisateur) du jeton d'accès, lu sans vérifier la signature : il ne sert qu'à
 * rattacher le cookie wab_org à son utilisateur, le moteur reste seul juge du jeton et des droits.
 */
export function accessSubject(access: string | undefined): string | undefined {
  const payload = access?.split('.')[1];
  if (!payload) return undefined;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    if (typeof decoded !== 'object' || decoded === null) return undefined;
    const sub = (decoded as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub.length > 0 ? sub : undefined;
  } catch {
    return undefined;
  }
}
