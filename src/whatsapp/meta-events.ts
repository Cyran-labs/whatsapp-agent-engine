/**
 * Événements Meta d'un lot authentifié (spec §7.4, §7.6) : statuts de livraison, `account_update` et événements de
 * numéro. Appelé après la vérification de la signature et le filtre de WABA, jamais avant.
 *
 * Tout est borné au compte reçu : un numéro est cherché dans l'inventaire de CE compte seulement, une entrée d'une
 * autre WABA est ignorée, un phone_number_id inconnu du compte n'écrit rien. Aucun journal ne porte un identifiant
 * de contact ni une donnée brute de la requête (nombres seulement).
 */
import type { Database } from '../core/database/types.js';
import type { WhatsAppAccountAlert, WhatsAppAccountRecord } from '../core/database/whatsapp-types.js';
import type { MetaWebhookBatch } from '../transport/meta-cloud.js';
import type { RefreshScheduler } from './refresh-scheduler.js';

/**
 * Codes d'échec de livraison qui disent quelque chose du compte (tâche 0, f1). 131031 couvre aussi un code PIN de
 * vérification en deux étapes incorrect : le libellé affiché ne doit pas affirmer que le compte est bloqué.
 */
export const ACCOUNT_ALERT_CODES: Record<number, WhatsAppAccountAlert['kind']> = {
  131042: 'payment',
  131031: 'account_locked',
  368: 'policy_block',
};

export interface MetaEventsDeps {
  db: Database;
  scheduler: RefreshScheduler;
}

function alertKindFor(code: number): WhatsAppAccountAlert['kind'] | undefined {
  return ACCOUNT_ALERT_CODES[code];
}

/** Un champ qui change l'inventaire ou l'état du compte : `account_update` et tout `phone_number_*`. */
function triggersRefresh(field: string): boolean {
  return field === 'account_update' || field.startsWith('phone_number_');
}

/**
 * Traite les statuts et événements de compte du lot. Ne lève pas pour une écriture en échec : l'échec est journalisé
 * (numéro de compte seulement) et le reste du lot continue.
 */
export async function handleMetaEvents(
  account: WhatsAppAccountRecord,
  batch: Pick<MetaWebhookBatch, 'statuses' | 'accountEvents'>,
  deps: MetaEventsDeps,
): Promise<void> {
  const waba = account.provider_account_id;
  const statuses = batch.statuses.filter((s) => s.providerAccountId === waba);
  const events = batch.accountEvents.filter((e) => e.entryId === waba);
  const now = new Date().toISOString();
  // Une alerte par nature et par lot : une rafale de statuts ne chasse pas les autres alertes (20 conservées).
  const alerted = new Set<string>();
  const addAlert = async (alert: WhatsAppAccountAlert): Promise<void> => {
    const key = `${alert.kind}/${alert.event ?? ''}`;
    if (alerted.has(key)) return;
    alerted.add(key);
    await deps.db.addWhatsAppAccountAlert(account.id, alert);
  };

  // Numéro cherché une fois par phone_number_id du lot, dans l'inventaire de ce compte seulement.
  const numbers = new Map<string, Awaited<ReturnType<Database['findPresentNumber']>>>();
  for (const status of statuses) {
    if (status.status !== 'failed' || status.recipientId === '') continue;
    try {
      if (!numbers.has(status.recipientId)) {
        numbers.set(status.recipientId, await deps.db.findPresentNumber(account.id, { providerNumberId: status.recipientId }));
      }
      const number = numbers.get(status.recipientId);
      if (!number) continue;
      await deps.db.recordDeliveryFailure(number.id, status.errorCodes[0] ?? null, now);
      for (const code of status.errorCodes) {
        const kind = alertKindFor(code);
        if (kind) await addAlert({ kind, code, event: null, at: now });
      }
    } catch (err) {
      console.error(`[MetaEvents] Statut non enregistré (compte ${account.id}):`, err instanceof Error ? err.message : String(err));
    }
  }

  let refresh = false;
  for (const event of events) {
    try {
      if (event.field === 'account_update') {
        await addAlert({ kind: 'account_update', code: null, event: event.event ?? null, at: now });
      }
    } catch (err) {
      console.error(`[MetaEvents] Événement de compte non enregistré (compte ${account.id}):`, err instanceof Error ? err.message : String(err));
    }
    if (triggersRefresh(event.field)) refresh = true;
  }
  // Un seul appel par lot ; le planificateur borne le rythme par compte.
  if (refresh) deps.scheduler.schedule(account.client_id, account.id);
}
