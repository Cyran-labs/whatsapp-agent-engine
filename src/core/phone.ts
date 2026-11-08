/**
 * Normalisation unique des numéros WhatsApp des organisations (E.164).
 *
 * Utilisée à l'écriture (service, pilotes de base) et à la lecture (routage), pour qu'un même
 * numéro ait une seule forme stockée : `+33612345678`. L'identifiant du contact n'est pas concerné.
 */

const SEPARATORS = /[\s.\-()]/g;

/**
 * Retourne le numéro en E.164 (`+` suivi de 8 à 15 chiffres, premier chiffre non nul),
 * ou `null` s'il n'est pas exploitable. Un numéro national (`06...`) est refusé, faute d'indicatif.
 */
export function normalizeWhatsAppNumber(input: string): string | null {
  let value = input.replace(SEPARATORS, '');
  if (value.startsWith('+')) value = value.slice(1);
  else if (value.startsWith('00')) value = value.slice(2);
  if (!/^[1-9][0-9]{7,14}$/.test(value)) return null;
  return `+${value}`;
}

/**
 * Pour les pilotes de base : liste E.164 dédoublonnée, ou erreur si une entrée est invalide.
 * La validation avec message utilisateur est faite en amont (BotService) ; ceci protège le stockage.
 */
export function toStoredWhatsAppNumbers(numbers: string[]): string[] {
  const out = new Set<string>();
  for (const n of numbers) {
    const normalized = normalizeWhatsAppNumber(n);
    if (normalized === null) throw new Error('[DB] Numéro WhatsApp invalide : format E.164 attendu.');
    out.add(normalized);
  }
  return [...out];
}
