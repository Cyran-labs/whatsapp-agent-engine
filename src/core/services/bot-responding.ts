// Mention « Ne répond pas » d'un agent IA (spec navigation §7) : faits lus dans l'organisation de l'agent IA, décision
// des contrats (`decideResponding`). Une lecture : la machine d'états et le routeur n'en dépendent pas.

import { decideResponding, type BotNumberSummary, type NotRespondingReason, type RespondingFacts } from '@wabagent/contracts';
import type { Database } from '../database/types.js';
import { loadBotNumberSummary } from './bot-number-summary.js';

/**
 * Faits de la règle. L'état du compte est l'état affiché (`BotNumberSummary.account.state`, signatures rejetées en série
 * comprises) : ces messages sont refusés par l'authentification du webhook, avant le routage (spec navigation §7.1).
 * `organizationStatus` : statut lu de l'organisation, null si elle est introuvable (comptée comme non active).
 */
export function respondingFacts(
  status: string, number: BotNumberSummary | null, organizationStatus: string | null, allowlistCount: number,
): RespondingFacts {
  return {
    status,
    number: number === null ? null : { present: number.provider_state === 'present', account_state: number.account.state },
    organizationActive: organizationStatus === 'active',
    allowlistCount,
  };
}

/** Mention d'un agent IA dont les faits ne sont pas encore lus ; tout est lu avec `clientId`, celui de l'agent IA. */
export async function loadNotResponding(
  db: Database, clientId: string, bot: { bot_id: string; status: string },
): Promise<NotRespondingReason | null> {
  const [number, client, allowlist] = await Promise.all([
    loadBotNumberSummary(db, clientId, bot.bot_id),
    db.getClient(clientId),
    db.getAllowlist(clientId, bot.bot_id),
  ]);
  return decideResponding(respondingFacts(bot.status, number, client?.status ?? null, allowlist.length));
}
