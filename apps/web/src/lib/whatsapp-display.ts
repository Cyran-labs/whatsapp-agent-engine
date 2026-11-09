// Affichage pur des numéros et dates des comptes WhatsApp : aucune règle métier, aucun appel réseau.

const E164 = /^\+[1-9]\d{6,14}$/;
const DAY_MS = 86_400_000;

function groups(digits: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < digits.length; i += size) out.push(digits.slice(i, i + size));
  return out;
}

/**
 * Numéro E.164 lisible : `+33612457890` donne `+33 6 12 45 78 90`, `+15551649072` donne `+1 555 164 9072`.
 * Autre indicatif : `+` puis l'indicatif (1 à 3 chiffres selon le plan E.164) et le reste par groupes de 3.
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
  const codeLength = digits[0] === '7' ? 1 : digits.length >= 11 ? 2 : 3;
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

/** Page « Numéros de téléphone » du compte WhatsApp Business dans WhatsApp Manager. */
export function whatsAppManagerUrl(wabaId: string): string {
  return `https://business.facebook.com/wa/manage/phone-numbers/?waba_id=${encodeURIComponent(wabaId)}`;
}
