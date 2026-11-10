/**
 * Texte d'une erreur interceptée, pour un journal : le message seulement, jamais l'objet entier (il peut porter une
 * réponse, des en-têtes ou des valeurs sensibles). Même forme que `err instanceof Error ? err.message : String(err)`.
 */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
