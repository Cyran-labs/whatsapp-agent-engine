import { findBotByNumber, type BotConfig } from './bot-config.js';
import { getDatabase } from './database/index.js';

export type Servable = 'ok' | 'bot_inactive' | 'org_inactive';

/**
 * Résolution de l'agent IA pour un message entrant : par numéro destinataire uniquement, LECTURE SEULE.
 *
 * Synchrone et sans accès aux sessions : une session ne change jamais l'agent IA routé
 * (sessions clées par numéro destinataire et contact, audit 1.1). La création de la session est faite par
 * l'appelant APRÈS la vérification HMAC, pour qu'un payload non signé ne puisse pas écrire de session.
 * Renvoie null si le numéro n'est pas normalisable ou n'est rattaché à aucun agent IA.
 */
export function findRoute(toNumber: string): BotConfig | null {
  return findBotByNumber(toNumber);
}

/**
 * Un agent IA est servi quand il est actif ET que son organisation est active (audit 3.1).
 * Les deux statuts sont lus en base à chaque appel, jamais dans la configuration en cache : deux écritures
 * concurrentes sur un même agent IA peuvent laisser le cache en retard sur la base (revue d'isolation I-1),
 * et un agent IA en pause ne doit jamais répondre. Un agent IA absent en base n'est pas servi.
 * En 2b-1, seul `active` est servi (`limited` arrive en 2b-2).
 */
export async function checkServable(bot: BotConfig): Promise<Servable> {
  const db = getDatabase();
  const record = await db.getBotRecord(bot.client_id, bot.bot_id);
  if (record?.status !== 'active') return 'bot_inactive';
  const client = await db.getClient(bot.client_id);
  if (client?.status !== 'active') return 'org_inactive';
  return 'ok';
}
