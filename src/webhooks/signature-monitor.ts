// Signatures de webhook rejetées en série, par compte WhatsApp (choix 4). Compteur en mémoire seulement :
// aucune écriture en base avant l'authentification d'un webhook. L'état stocké du compte n'est pas touché ;
// seul l'état affiché et vu par la machine d'états des agents IA passe en `error` (motif `signature_rejected`).
// Le compteur n'est alimenté que pour un compte déjà identifié par sa clé d'URL : il est borné par le nombre de comptes.

/** Au-delà de ce nombre de POST rejetés sans POST valide, le compte compte comme en erreur. */
export const SIGNATURE_REJECTION_THRESHOLD = 20;

const failures = new Map<number, number>();

export function recordSignatureFailure(accountId: number): void {
  failures.set(accountId, (failures.get(accountId) ?? 0) + 1);
}

/** Une signature valide lève l'état et remet le compteur à zéro. */
export function recordSignatureSuccess(accountId: number): void {
  failures.delete(accountId);
}

export function isSignatureRejected(accountId: number): boolean {
  return (failures.get(accountId) ?? 0) > SIGNATURE_REJECTION_THRESHOLD;
}

/** Tests uniquement. */
export function resetSignatureMonitor(): void {
  failures.clear();
}
