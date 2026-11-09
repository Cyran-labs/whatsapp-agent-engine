/** Pages accessibles sans session (première partie du chemin après la langue). Source unique du middleware et de `safeNext`. */
export const PUBLIC_SEGMENTS: readonly string[] = ['login', 'accept-invite', 'forgot-password', 'reset-password', 'forbidden'];

/** Vrai si le premier segment (après la langue éventuelle) est une page publique d'authentification. */
export function isPublicSegment(segment: string | undefined): boolean {
  return segment !== undefined && PUBLIC_SEGMENTS.includes(segment);
}
