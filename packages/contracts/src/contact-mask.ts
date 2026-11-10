/**
 * Masque d'un numéro de contact (spec navigation 9.2, choix P-3 révisé à la relecture de la tâche 3), appliqué par le
 * moteur pour un membre qui ne voit pas les numéros des contacts en entier. Module pur, partagé par le moteur et le
 * faux moteur du web.
 *
 * - Valeur faite de chiffres, précédés ou non de « + », d'au moins 8 chiffres (n) : au moins 6 chiffres restent
 *   cachés. Visibles : un préfixe de min(3, n - 8) premiers chiffres et les 2 derniers. Rendu : « + » s'il y en avait
 *   un, le préfixe, ` •• •• •• `, les 2 derniers (`+336 •• •• •• 78` pour `+33612345678`). Le format fixe ne trahit
 *   pas la longueur du numéro.
 * - Valeur faite de chiffres de moins de 8 chiffres : `••••`.
 * - Toute autre valeur (identifiant WhatsApp BSUID) : ses 2 premiers caractères puis `••••` (`US••••`), `••••` si elle
 *   fait 4 caractères ou moins.
 *
 * Le résultat ne contient jamais la valeur entière, ni plus de 3 de ses chiffres consécutifs.
 */
const HIDDEN = '••••';
const NUMERIC = /^(\+?)(\d+)$/;
const MIN_DIGITS = 8;
const MIN_HIDDEN = 6;
const MAX_PREFIX = 3;

export function maskContactNumber(value: string): string {
  const numeric = NUMERIC.exec(value);
  if (numeric) {
    const plus = numeric[1]!;
    const digits = numeric[2]!;
    if (digits.length < MIN_DIGITS) return HIDDEN;
    const prefix = digits.slice(0, Math.max(0, Math.min(MAX_PREFIX, digits.length - MIN_HIDDEN - 2)));
    return `${plus}${prefix} •• •• •• ${digits.slice(-2)}`;
  }
  return value.length > 4 ? `${value.slice(0, 2)}${HIDDEN}` : HIDDEN;
}
