import type { BotConfig } from './bot-config.js';
import { getDatabase } from './database/index.js';
import type { WhatsAppAccountRecord, WhatsAppNumberRecord } from './database/whatsapp-types.js';
import { contactMatchesAllowlist } from './phone.js';

/**
 * Route d'un message entrant, résolue par le webhook APRÈS l'authentification : le compte WhatsApp identifié
 * par la clé d'URL, le numéro destinataire cherché dans l'inventaire de CE compte, l'agent IA branché sur
 * ce numéro. Il n'existe qu'une façon de router un message : par le numéro destinataire (1 numéro = 1 agent IA).
 */
export interface Route {
  account: WhatsAppAccountRecord;
  number: WhatsAppNumberRecord;
  bot: BotConfig;
}

/**
 * Verdict de service d'une route pour un contact :
 *   - ok : le message est servi ;
 *   - route_changed : le numéro n'est plus branché sur cet agent IA, ou n'existe plus (le message n'appartient
 *     plus à personne, il n'est compté pour aucun agent IA) ;
 *   - number_removed : numéro retiré chez le fournisseur ;
 *   - account_error : compte WhatsApp pas `connected` (jeton refusé, déconnecté) ;
 *   - org_inactive : organisation absente ou pas `active` ;
 *   - bot_inactive : agent IA absent, en brouillon, en pause ou de statut inconnu ;
 *   - not_allowed : agent IA en accès limité, contact absent de la liste.
 */
export type Servable = 'ok' | 'bot_inactive' | 'org_inactive' | 'account_error' | 'not_allowed' | 'number_removed' | 'route_changed';

/** Verdict et, s'il est `ok`, le compte et le numéro tels que relus en base. */
export type RouteCheck =
  | { servable: 'ok'; account: WhatsAppAccountRecord; number: WhatsAppNumberRecord }
  | { servable: Exclude<Servable, 'ok'> };

/**
 * Relit en base, à chaque appel, tout ce qui décide de servir un message (jamais le cache de configuration,
 * revue d'isolation I-1) : le numéro (toujours dans ce compte et cette organisation, toujours branché sur cet
 * agent IA, toujours présent), le compte, l'organisation, le statut de l'agent IA et, en accès limité, la liste.
 * Lecture seule : le compteur des messages non servis est tenu par l'appelant (src/webhooks/pipeline.ts).
 * Verdict `ok` : renvoie aussi le compte et le numéro relus, pour construire le transport avec eux.
 */
export async function checkRoute(route: Route, contactId: string): Promise<RouteCheck> {
  const db = getDatabase();
  const clientId = route.account.client_id;
  const botId = route.bot.bot_id;
  if (route.bot.client_id !== clientId || route.number.client_id !== clientId) return { servable: 'route_changed' };

  const number = await db.getWhatsAppNumber(clientId, route.number.id);
  if (!number || number.account_id !== route.account.id || number.bot_id !== botId) return { servable: 'route_changed' };
  if (number.provider_state !== 'present') return { servable: 'number_removed' };

  const account = await db.getWhatsAppAccount(clientId, route.account.id);
  if (!account || account.state !== 'connected') return { servable: 'account_error' };

  const client = await db.getClient(clientId);
  if (client?.status !== 'active') return { servable: 'org_inactive' };

  const bot = await db.getBotRecord(clientId, botId);
  if (bot?.status === 'active') return { servable: 'ok', account, number };
  if (bot?.status !== 'limited') return { servable: 'bot_inactive' };
  const allowlist = await db.getAllowlist(clientId, botId);
  return contactMatchesAllowlist(contactId, allowlist) ? { servable: 'ok', account, number } : { servable: 'not_allowed' };
}

/** Verdict seul de `checkRoute`. */
export async function resolveServable(route: Route, contactId: string): Promise<Servable> {
  return (await checkRoute(route, contactId)).servable;
}
