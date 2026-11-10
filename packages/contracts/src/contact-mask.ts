/**
 * Masque d'un numéro de contact (spec navigation 9.2, choix P-3), appliqué par le moteur pour un membre qui ne voit pas
 * les numéros des contacts en entier. Module pur, partagé par le moteur et le faux moteur du web.
 *
 * - Valeur faite de chiffres, précédés ou non de « + », d'au moins 9 chiffres : « + », les 5 premiers chiffres,
 *   « •• •• », puis les 2 derniers (`+33612 •• •• 78`).
 * - Valeur faite de chiffres de moins de 9 chiffres : `••••`.
 * - Toute autre valeur (identifiant WhatsApp BSUID) : ses 2 premiers caractères puis `••••` (`US••••`), `••••` si elle
 *   fait 4 caractères ou moins.
 *
 * Le résultat ne contient jamais la valeur entière, ni plus de 5 de ses chiffres consécutifs.
 */
const HIDDEN = '••••';
const NUMERIC = /^\+?(\d+)$/;
const MIN_DIGITS = 9;

export function maskContactNumber(value: string): string {
  const numeric = NUMERIC.exec(value);
  if (numeric) {
    const digits = numeric[1]!;
    return digits.length >= MIN_DIGITS ? `+${digits.slice(0, 5)} •• •• ${digits.slice(-2)}` : HIDDEN;
  }
  return value.length > 4 ? `${value.slice(0, 2)}${HIDDEN}` : HIDDEN;
}
