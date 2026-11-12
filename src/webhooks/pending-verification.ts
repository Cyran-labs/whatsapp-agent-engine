/**
 * Vérifications Meta attendues pendant un raccordement (lot R1, spec §5.2).
 *
 * Quand le moteur inscrit l'URL de webhook d'un compte chez Meta (`POST subscribed_apps` avec
 * `override_callback_uri` et `verify_token`), Meta envoie aussitôt un GET de vérification à cette URL, avant que
 * le compte existe en base. Le GET de `/webhook/meta/<clé>` répond alors depuis ce registre : jeton attendu,
 * enregistré sous l'empreinte SHA-256 de la clé (jamais la clé en clair), libéré par l'appelant ou expiré seul.
 *
 * Limite assumée : registre propre au processus (mémoire). Avec plusieurs instances, le GET de Meta peut tomber
 * sur une autre instance et être refusé ; le multi-instance est différé au chantier Infra (spec R1 §5.2).
 *
 * Seul le GET consulte ce registre : un POST sur une clé seulement en attente répond 404, rien n'est servi.
 */
import { hashWebhookKey } from '../whatsapp/webhook-key.js';
import { constantTimeEqual } from './constant-time.js';

/** Durée de vie d'une vérification attendue : le GET de Meta suit l'inscription de quelques secondes. */
export const PENDING_VERIFICATION_TTL_MS = 60_000;

// Valeur de comparaison quand rien n'est attendu pour la clé : le refus coûte une comparaison complète.
const NO_PENDING_TOKEN = 'aucun-jeton-en-attente';

interface PendingEntry {
  verifyToken: string;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingEntry>();

/**
 * Enregistre le jeton attendu pour la clé d'URL. Renvoie la fonction de libération (idempotente, sans effet sur
 * une entrée enregistrée depuis pour la même clé). L'entrée expire seule après `ttlMs`. Un jeton ou une clé vides
 * lèvent (registre R1 T4b) : rien n'est enregistré.
 */
export function registerPendingVerification(
  webhookKey: string, verifyToken: string, ttlMs: number = PENDING_VERIFICATION_TTL_MS,
): () => void {
  if (verifyToken === '' || webhookKey === '') throw new Error('[PendingVerification] Clé ou jeton de vérification vide');
  const hash = hashWebhookKey(webhookKey);
  const previous = pending.get(hash);
  if (previous) clearTimeout(previous.timer);
  const timer = setTimeout(() => {
    if (pending.get(hash) === entry) pending.delete(hash);
  }, ttlMs);
  timer.unref();
  const entry: PendingEntry = { verifyToken, expiresAt: Date.now() + ttlMs, timer };
  pending.set(hash, entry);
  return () => {
    clearTimeout(entry.timer);
    if (pending.get(hash) === entry) pending.delete(hash);
  };
}

/** Vrai si un raccordement en cours attend ce jeton pour cette clé. Comparaison en temps constant. */
export function matchPendingVerification(webhookKey: string, token: string): boolean {
  const entry = pending.get(hashWebhookKey(webhookKey));
  const live = entry !== undefined && Date.now() < entry.expiresAt;
  const matches = constantTimeEqual(token, live ? entry.verifyToken : NO_PENDING_TOKEN);
  return live && matches;
}

/** Tests uniquement : vide le registre. */
export function resetPendingVerificationsForTests(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
}

/** Tests uniquement : clés du registre (empreintes). */
export function pendingVerificationKeysForTests(): string[] {
  return [...pending.keys()];
}
