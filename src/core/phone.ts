import { ALLOWLIST_ENTRY_MAX } from '@wabagent/contracts';

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

/** Identifiant de contact WhatsApp par BSUID (ex. `FR.abc123`), distinct d'un numéro de téléphone. */
export function isBsuid(id: string): boolean {
  return /^[A-Z]{2}\.[A-Za-z0-9_]+$/.test(id);
}

/**
 * Entrée de liste d'accès limité : un BSUID est conservé tel quel (après `trim`), un numéro est
 * normalisé en E.164. `null` si l'entrée n'est ni l'un ni l'autre, ou si elle dépasse 64 caractères.
 */
export function normalizeAllowlistEntry(input: string): string | null {
  if (input.length > ALLOWLIST_ENTRY_MAX) return null;
  const trimmed = input.trim();
  if (isBsuid(trimmed)) return trimmed;
  return normalizeWhatsAppNumber(trimmed);
}

/**
 * Le contact figure-t-il dans la liste d'accès limité ? Un BSUID se compare tel quel, un numéro se
 * compare en E.164 aux entrées normalisées. Aucun passage de l'un à l'autre.
 */
export function contactMatchesAllowlist(contactId: string, entries: string[]): boolean {
  if (isBsuid(contactId)) return entries.includes(contactId);
  const normalized = normalizeWhatsAppNumber(contactId);
  return normalized !== null && entries.includes(normalized);
}

const MASK = '•••';

/**
 * Identifiant de contact masqué pour les journaux (aucune donnée personnelle en clair).
 * Un numéro garde son indicatif et ses 2 derniers chiffres (`+33612345678` donne `+33•••••••78`, la longueur est
 * conservée) ; tout autre identifiant (BSUID) garde ses 4 premiers caractères suivis de `•••`.
 * L'indicatif est supposé à 1 chiffre pour `+1` et `+7`, à 2 chiffres sinon : suffisant pour reconnaître la région
 * sans dévoiler le numéro.
 * Journaux seulement : une réponse de l'API à un membre qui ne voit pas les numéros des contacts passe par
 * `maskContactNumber` des contrats (`packages/contracts/src/contact-mask.ts`), qui ne trahit pas la longueur.
 */
export function maskContact(id: string): string {
  const e164 = normalizeWhatsAppNumber(id);
  if (e164 !== null) {
    const digits = e164.slice(1);
    const codeLength = digits.startsWith('1') || digits.startsWith('7') ? 1 : 2;
    const hidden = digits.length - codeLength - 2;
    return `+${digits.slice(0, codeLength)}${'•'.repeat(hidden)}${digits.slice(-2)}`;
  }
  return id.length > 4 ? `${id.slice(0, 4)}${MASK}` : MASK;
}

/**
 * Contact d'un lead pour les journaux : l'adresse e-mail masquée si elle existe, sinon le numéro masqué
 * (`•••` si aucun des deux n'est connu).
 */
export function maskLeadContact(lead: { email?: string; phone?: string }): string {
  if (lead.email) return maskEmail(lead.email);
  return maskContact(lead.phone ?? '');
}

/** Adresse e-mail masquée pour les journaux : `claire.bernard@x.fr` donne `c•••@x.fr`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 0) return MASK;
  const local = email.slice(0, at);
  return `${local.slice(0, 1)}${MASK}${email.slice(at)}`;
}
