// Affichage pur des numéros et dates des comptes WhatsApp : aucune règle métier, aucun appel réseau.

const E164 = /^\+[1-9]\d{6,14}$/;
const DAY_MS = 86_400_000;

/** Indicatifs E.164 à 2 chiffres (ceux de 1 chiffre sont 1 et 7 ; tous les autres ont 3 chiffres). */
const TWO_DIGIT_CODES: ReadonlySet<string> = new Set([
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66',
  '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98',
]);

function groups(digits: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < digits.length; i += size) out.push(digits.slice(i, i + size));
  return out;
}

/**
 * Numéro E.164 lisible : `+33612457890` donne `+33 6 12 45 78 90`, `+15551649072` donne `+1 555 164 9072`.
 * Autre indicatif : `+` puis l'indicatif et le reste par groupes de 3. Longueur de l'indicatif selon le plan E.164 :
 * 1 chiffre pour 1 et 7, 2 chiffres pour les indicatifs de la table `TWO_DIGIT_CODES`, 3 chiffres sinon.
 * Une entrée qui n'est pas du E.164 est rendue telle quelle.
 */
export function formatPhone(e164: string): string {
  if (!E164.test(e164)) return e164;
  const digits = e164.slice(1);
  if (digits.startsWith('33') && digits.length === 11) {
    const national = digits.slice(2);
    return `+33 ${national[0]} ${groups(national.slice(1), 2).join(' ')}`;
  }
  if (digits.startsWith('1') && digits.length === 11) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  const codeLength = digits[0] === '7' ? 1 : TWO_DIGIT_CODES.has(digits.slice(0, 2)) ? 2 : 3;
  return `+${digits.slice(0, codeLength)} ${groups(digits.slice(codeLength), 3).join(' ')}`;
}

/** Lien `wa.me` d'un numéro : chiffres seuls. */
export function waMeUrl(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}`;
}

/** Jours restants avant `iso`, arrondis vers le haut ; 0 si la date est dépassée. */
export function daysUntil(iso: string, now: Date): number {
  const diff = new Date(iso).getTime() - now.getTime();
  return diff > 0 ? Math.ceil(diff / DAY_MS) : 0;
}

/** App Meta d'un compte (destinataires du numéro de test, API Setup) ; liste des apps si l'identifiant est inconnu. */
export function metaAppUrl(appId: string | null): string {
  return appId === null ? 'https://developers.facebook.com/apps/' : `https://developers.facebook.com/apps/${encodeURIComponent(appId)}/`;
}

/** Page « Numéros de téléphone » du compte WhatsApp Business dans WhatsApp Manager. */
export function whatsAppManagerUrl(wabaId: string): string {
  return `https://business.facebook.com/wa/manage/phone-numbers/?waba_id=${encodeURIComponent(wabaId)}`;
}

/** Codes d'erreur de remise de Meta dont le sens est traduit (documentation Meta des codes d'erreur de la Cloud API). */
const KNOWN_DELIVERY_CODES: ReadonlySet<number> = new Set([131047, 131026, 131042, 131056, 130472]);

/**
 * Clé (depuis la racine des messages) du texte d'un code d'erreur de remise : le sens du code s'il est connu,
 * `unknown` (« Code Meta {code} », qui demande le paramètre `code`) sinon, `none` sans code.
 */
export function deliveryErrorKey(code: number | null): string {
  if (code === null) return 'connections.delivery.none';
  return KNOWN_DELIVERY_CODES.has(code) ? `connections.delivery.${code}` : 'connections.delivery.unknown';
}
