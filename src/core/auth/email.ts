/** Forme canonique d'une adresse e-mail (identité du compte) : sans espaces, en minuscules. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
