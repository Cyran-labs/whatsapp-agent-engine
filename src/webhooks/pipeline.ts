/**
 * Traitement d'un message entrant déjà authentifié (signature Meta ou clé d'URL CM.com vérifiées) et routé
 * (numéro destinataire trouvé dans l'inventaire du compte de l'URL, agent IA branché). Ordre (revue 2b-1 M-5) :
 *   1. message trop ancien : fin (audit 5.13) ;
 *   2. message sans réponse attendue (réaction) : fin ;
 *   3. réservation `<numéro E.164>:<identifiant>` (dédoublonnage atomique), doublon : fin, rien compté ;
 *   4. route relue en base (`resolveServable`), refus : compteur (sauf route changée), marquage traité, fin ;
 *   5. sous le verrou (numéro, contact) : route relue de nouveau, mot-clé « reset » d'un contact de la liste
 *      (choix 9), session, accueil, réponse ; marquage traité dans tous les cas.
 *
 * Les journaux du pipeline lui-même ne portent ni l'identifiant du contact ni le contenu du message. Ceux des
 * transports et du handler relèvent de l'audit complet (revue d'isolation M-6).
 */
import { config } from '../core/config.js';
import { checkRoute, resolveServable } from '../core/router.js';
import type { Route, Servable } from '../core/router.js';
import {
  claimMessage, completeMessage, createSessionIfAbsent, getDatabase, incrementUnserved, touchSession,
} from '../core/db.js';
import { handleMessage, handleWelcome, sendFixedReply } from '../core/handler.js';
import type { ConversationContext } from '../core/handler.js';
import { withConversationLock } from '../core/conversation-lock.js';
import type { InFlightTracker } from '../core/in-flight.js';
import { contactMatchesAllowlist } from '../core/phone.js';
import { findBotConfig } from '../core/config-store.js';
import type { WhatsAppAccountRecord, WhatsAppNumberRecord } from '../core/database/whatsapp-types.js';
import { getTransportForNumber } from '../transport/index.js';
import type { Transport, IncomingMessage } from '../transport/types.js';
import { TransportSendError } from '../transport/types.js';

/** Délai après lequel une réservation restée « en cours » (traitement interrompu) peut être reprise. */
const CLAIM_STALE_AFTER_SECONDS = 300;

const AUDIO_REPLY = 'Les messages vocaux ne sont pas encore supportés. Écrivez-moi votre réponse.';
const TEXT_ONLY_REPLY = 'Je ne peux traiter que les messages texte. Écrivez-moi votre question.';
const RESET_REPLY = 'Conversation réinitialisée.';

export interface ServeInput {
  route: Route;
  /**
   * Transport du numéro de la route à la réception. Il n'est pas réutilisé sous le verrou : le traitement le
   * reconstruit avec le compte et le numéro relus en base.
   */
  transport: Transport;
  message: IncomingMessage;
}

/**
 * Début de l'identifiant de message, pour les journaux (jamais le contact), réduit aux caractères
 * [A-Za-z0-9._:=-] : aucun saut de ligne ni contrôle venu de la requête. À n'utiliser qu'après authentification.
 */
export function shortMessageId(messageId: string): string {
  const safe = messageId.replace(/[^A-Za-z0-9._:=-]/g, '');
  return safe.length > 16 ? `${safe.slice(0, 16)}...` : safe;
}

/** Type d'origine chez le fournisseur, filtré pour les journaux (CM.com : type de contenu reçu). */
function safeProviderType(providerType: string): string {
  const safe = providerType.replace(/[^A-Za-z0-9._/+-]/g, '').slice(0, 40);
  return safe === '' ? 'inconnu' : safe;
}

function routeLabel(route: Route): string {
  return `${route.bot.client_id}/${route.bot.bot_id}`;
}

/** Âge du message en heures ; un horodatage illisible vaut « maintenant », jamais « ancien ». */
function messageAgeHours(timestamp: string): number {
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) return 0;
  return (Date.now() - time) / 3_600_000;
}

/** Mot-clé « reset » (choix 9) : le texte, sans espaces de début et de fin et en minuscules, vaut `reset`. */
function isResetKeyword(message: IncomingMessage): boolean {
  return message.kind === 'text' && message.text.trim().toLowerCase() === 'reset';
}

/**
 * Refus : journal sans contact ni contenu, puis compteur de l'agent IA (spec §8.4), sauf pour une route changée
 * (le numéro n'appartient plus à cet agent IA : le message n'est le message non servi de personne).
 */
async function refuse(route: Route, reason: Exclude<Servable, 'ok'>, messageId: string): Promise<void> {
  const label = routeLabel(route);
  if (reason === 'route_changed') {
    console.warn(`[Pipeline] Routage modifié (${label}, ${shortMessageId(messageId)}), message écarté`);
    return;
  }
  console.warn(`[Pipeline] Agent IA non servi (${reason}) ${label}, message ${shortMessageId(messageId)}`);
  try {
    await incrementUnserved(route.bot.client_id, route.bot.bot_id);
  } catch (err) {
    console.error(`[Pipeline] Compteur de messages non servis non mis à jour (${label}):`, err instanceof Error ? err.message : String(err));
  }
}

// Marque le message traité ; une erreur de base ne doit jamais remonter (la réservation sera reprise après le délai).
async function completeQuietly(key: string, route: Route): Promise<void> {
  try {
    await completeMessage(key);
  } catch (err) {
    console.error(`[Pipeline] Marquage traité impossible (${routeLabel(route)}):`, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Route un message authentifié : `number` est le résultat de la recherche du numéro destinataire dans
 * l'inventaire du compte de l'URL (numéros présents seulement). Un numéro absent, libre, sans agent IA connu
 * ou sans transport est ignoré ; un numéro d'un autre compte ou d'une autre organisation (impossible par la
 * recherche) est ignoré et journalisé comme anomalie. Les journaux ne portent que des identifiants de la base.
 */
export async function routeAndServe(
  service: string,
  account: WhatsAppAccountRecord,
  number: WhatsAppNumberRecord | undefined,
  message: IncomingMessage,
  tracker: InFlightTracker,
): Promise<void> {
  const shortId = shortMessageId(message.messageId);
  if (!number) {
    console.warn(`[${service}] Message ${shortId} pour un numéro inconnu du compte ${account.id}, ignoré`);
    return;
  }
  if (number.account_id !== account.id || number.client_id !== account.client_id) {
    console.error(`[${service}] Anomalie : numéro ${number.id} hors du compte ${account.id} ou de son organisation, message ${shortId} ignoré`);
    return;
  }
  if (number.bot_id === null) {
    console.warn(`[${service}] Message ${shortId} pour le numéro ${number.id} sans agent IA (compte ${account.id}), ignoré`);
    return;
  }
  const bot = findBotConfig(number.client_id, number.bot_id);
  if (!bot) {
    console.warn(`[${service}] Agent IA du numéro ${number.id} introuvable (compte ${account.id}), message ${shortId} ignoré`);
    return;
  }
  const transport = getTransportForNumber(account, number);
  if (!transport) {
    console.warn(`[${service}] Transport indisponible pour le compte ${account.id} (numéro ${number.id}), message ${shortId} ignoré`);
    return;
  }
  await serveMessage({ route: { account, number, bot }, transport, message }, tracker);
}

/**
 * Sert un message authentifié et routé. Résout une fois le message réservé et mis en file sous le verrou de
 * sa conversation : le traitement lui-même (LLM, envois) est suivi par `tracker`, ce qui permet de traiter
 * en parallèle les conversations d'un même lot tout en gardant l'ordre au sein d'une conversation.
 */
export async function serveMessage(input: ServeInput, tracker: InFlightTracker): Promise<void> {
  const { route, message } = input;
  const label = routeLabel(route);
  const shortId = shortMessageId(message.messageId);
  const waNumber = route.number.phone_e164;

  const ageHours = messageAgeHours(message.timestamp);
  if (ageHours > config.webhook.maxMessageAgeHours) {
    console.log(`[Pipeline] Message trop ancien ignoré (${label}, ${shortId}, ${Math.floor(ageHours)} h)`);
    return;
  }

  if (message.kind === 'ignored') {
    console.log(`[Pipeline] Message sans réponse attendue (${label}, type=${safeProviderType(message.providerType)})`);
    return;
  }

  // Clé préfixée par le numéro destinataire : un identifiant réutilisé ne bloque pas une autre organisation.
  // Réservée avant le contrôle de service : une relivraison d'un message non servi n'est comptée qu'une fois (M-5).
  const key = `${waNumber}:${message.messageId}`;
  if (!(await claimMessage(key, CLAIM_STALE_AFTER_SECONDS))) {
    console.log(`[Pipeline] Doublon ignoré (${label}, ${shortId})`);
    return;
  }

  let servable: Servable;
  try {
    servable = await resolveServable(route, message.contactId);
  } catch (err) {
    // Réservation laissée « en cours » : une relivraison après le délai de reprise sera de nouveau examinée.
    console.error(`[Pipeline] Route illisible (${label}, ${shortId}):`, err instanceof Error ? err.message : String(err));
    return;
  }
  if (servable !== 'ok') {
    await refuse(route, servable, message.messageId);
    await completeQuietly(key, route);
    return;
  }

  const work = withConversationLock(`${waNumber}|${message.contactId}`, async () => {
    try {
      await processLocked(input);
    } catch (err) {
      console.error(`[Pipeline] Échec du traitement (${label}, ${shortId}):`, err instanceof Error ? err.message : String(err));
    } finally {
      await completeQuietly(key, route);
    }
  });
  void tracker.track(work).catch(() => undefined);
}

async function processLocked(input: ServeInput): Promise<void> {
  const { route, message } = input;
  const { bot } = route;
  const label = routeLabel(route);
  const shortId = shortMessageId(message.messageId);
  const waNumber = route.number.phone_e164;

  // Route relue : le message a pu attendre derrière le verrou pendant un branchement, une pause, une erreur de
  // compte ou un remplacement des secrets.
  const check = await checkRoute(route, message.contactId);
  if (check.servable !== 'ok') {
    await refuse(route, check.servable, message.messageId);
    return;
  }
  // Transport reconstruit avec le compte et le numéro relus : le transport de la réception (avant le verrou)
  // peut porter des secrets remplacés depuis. Aucun transport : le message est écarté comme une route changée.
  const transport = getTransportForNumber(check.account, check.number);
  if (!transport) {
    await refuse(route, 'route_changed', message.messageId);
    return;
  }

  const ctx: ConversationContext = {
    bot,
    accountId: route.account.id,
    transport,
    waNumber,
    contactId: message.contactId,
    messageId: message.messageId,
    ...(message.profileName ? { profileName: message.profileName } : {}),
  };

  // Choix 9 : seul un contact de la liste d'accès limité de l'agent IA peut réinitialiser sa conversation.
  if (isResetKeyword(message)) {
    const allowlist = await getDatabase().getAllowlist(bot.client_id, bot.bot_id);
    if (contactMatchesAllowlist(message.contactId, allowlist)) {
      await getDatabase().resetContactConversation(waNumber, message.contactId, bot.client_id, bot.bot_id);
      console.log(`[Pipeline] Conversation réinitialisée (${label}, ${shortId})`);
      await sendFixedReply(ctx, RESET_REPLY);
      return;
    }
  }

  const isNewSession = await createSessionIfAbsent(waNumber, message.contactId, bot.client_id, bot.bot_id);
  if (isNewSession) console.log(`[Pipeline] Nouvelle session (${label})`);
  else await touchSession(waNumber, message.contactId);

  // Nouvelle session avec accueil : l'accueil part d'abord (y compris avant la réponse fixe d'un premier
  // message non texte), puis le message est traité (audit 5.6, spec 2b §5.7).
  if (isNewSession && bot.welcome.enabled) {
    try {
      await handleWelcome(ctx);
    } catch (err) {
      if (err instanceof TransportSendError && err.kind === 'auth') {
        // Jeton refusé : la réponse échouerait aussi, inutile d'appeler le LLM ou d'envoyer la réponse fixe.
        console.warn(`[Pipeline] Accueil refusé (jeton), message non traité (${label}, ${shortId})`);
        return;
      }
      console.error(`[Pipeline] Accueil non envoyé (${label}):`, err instanceof Error ? err.message : String(err));
    }
  }

  if (message.kind === 'audio' || message.kind === 'media' || message.kind === 'unsupported') {
    console.log(`[Pipeline] Message non texte (${label}, type=${safeProviderType(message.providerType)})`);
    await sendFixedReply(ctx, message.kind === 'audio' ? AUDIO_REPLY : TEXT_ONLY_REPLY);
    return;
  }

  await handleMessage(ctx, message.text);
}
