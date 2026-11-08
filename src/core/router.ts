import { findBotByNumber, type BotConfig } from './bot-config.js';

export interface RouteResult {
  client_id: string;
  bot_id: string;
  config: BotConfig;
}

/**
 * Résolution de l'agent IA pour un message entrant : par numéro destinataire uniquement, LECTURE SEULE.
 *
 * Aucune consultation ni écriture de session : une session ne change jamais l'agent IA routé
 * (sessions clées par numéro destinataire et contact, audit 1.1). La création de la session est faite par
 * l'appelant APRÈS la vérification HMAC, pour qu'un payload non signé ne puisse pas écrire de session.
 */
export async function routeIncomingMessage(
  _fromPhone: string,
  toNumber: string
): Promise<RouteResult | null> {
  const cfg = findBotByNumber(toNumber);
  if (!cfg) {
    console.warn(`[Router] No bot configured for incoming number ${toNumber}`);
    return null;
  }

  return { client_id: cfg.client_id, bot_id: cfg.bot_id, config: cfg };
}
