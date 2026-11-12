/** Pages accessibles sans session (première partie du chemin après la langue). Source unique du middleware et de `safeNext`. */
export const PUBLIC_SEGMENTS: readonly string[] = ['login', 'accept-invite', 'forgot-password', 'reset-password'];

/** Vrai si le premier segment (après la langue éventuelle) est une page publique d'authentification. */
export function isPublicSegment(segment: string | undefined): boolean {
  return segment !== undefined && PUBLIC_SEGMENTS.includes(segment);
}

/**
 * Segments d'un chemin tels que Next les voit après décodage (`/fr/%6Cogin` est servi comme `/fr/login`). Null si un
 * segment est mal encodé ou, une fois décodé, contient un séparateur (`%2F`, `%5C`) : ce chemin n'est pas lu.
 */
export function decodedSegments(pathname: string): string[] | null {
  const decoded: string[] = [];
  for (const segment of pathname.split('/').filter(Boolean)) {
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (value.includes('/') || value.includes('\\')) return null;
    decoded.push(value);
  }
  return decoded;
}
