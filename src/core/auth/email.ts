/** Forme canonique d'une adresse e-mail (identité du compte) : sans espaces, en minuscules. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Adresse masquée pour un affichage public : première lettre de la partie locale, puis cinq points, puis le domaine. */
export function maskEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  const local = at === -1 ? normalized : normalized.slice(0, at);
  const domain = at === -1 ? '' : normalized.slice(at);
  return `${local.charAt(0)}•••••${domain}`;
}
