/**
 * Traitement d'un message entrant déjà authentifié (signature Meta ou secret d'URL CM.com vérifiés,
 * numéro destinataire rattaché à l'agent IA). Ordre :
 *   1. agent IA et organisation servis, sinon compteur et fin ;
 *   2. message trop ancien : fin (audit 5.13) ;
 *   3. message sans réponse attendue (réaction) : fin ;
 *   4. réservation `<numéro>:<identifiant>` (dédoublonnage atomique), doublon : fin ;
 *   5. sous le verrou (numéro, contact) : statut relu, session, réponse, marquage traité dans tous les cas.
 *
 * Les journaux du pipeline lui-même ne portent ni l'identifiant du contact ni le contenu du message. Ceux des
 * transports et du handler relèvent de l'audit complet (revue d'isolation M-6).
 */
import { config } from '../core/config.js';
import { checkServable, findRoute } from '../core/router.js';
import type { BotConfig } from '../core/bot-config.js';
import {
  claimMessage, completeMessage, createSessionIfAbsent, incrementUnserved, touchSession,
} from '../core/db.js';
import { handleMessage, handleWelcome, sendFixedReply } from '../core/handler.js';
import type { ConversationContext } from '../core/handler.js';
import { withConversationLock } from '../core/conversation-lock.js';
import type { InFlightTracker } from '../core/in-flight.js';
import type { Transport, IncomingMessage } from '../transport/types.js';
import { TransportSendError } from '../transport/types.js';

/** Délai après lequel une réservation restée « en cours » (traitement interrompu) peut être reprise. */
const CLAIM_STALE_AFTER_SECONDS = 300;

const AUDIO_REPLY = 'Les messages vocaux ne sont pas encore supportés. Écrivez-moi votre réponse.';
const TEXT_ONLY_REPLY = 'Je ne peux traiter que les messages texte. Écrivez-moi votre question.';

export interface ServeInput {
  bot: BotConfig;
  transport: Transport;
  /** Numéro destinataire normalisé (E.164), rattaché à `bot`. */
  waNumber: string;
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

function botLabel(bot: BotConfig): string {
  return `${bot.client_id}/${bot.bot_id}`;
}

/** Âge du message en heures ; un horodatage illisible vaut « maintenant », jamais « ancien ». */
function messageAgeHours(timestamp: string): number {
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) return 0;
  return (Date.now() - time) / 3_600_000;
}

async function countUnserved(bot: BotConfig, reason: string, messageId: string): Promise<void> {
  console.warn(`[Pipeline] Agent IA non servi (${reason}) ${botLabel(bot)}, message ${shortMessageId(messageId)}`);
  try {
    await incrementUnserved(bot.client_id, bot.bot_id);
  } catch (err) {
    console.error(`[Pipeline] Compteur de messages non servis non mis à jour (${botLabel(bot)}):`, err instanceof Error ? err.message : String(err));
  }
}

// Marque le message traité ; une erreur de base ne doit jamais remonter (la réservation sera reprise après le délai).
async function completeQuietly(key: string, bot: BotConfig): Promise<void> {
  try {
    await completeMessage(key);
  } catch (err) {
    console.error(`[Pipeline] Marquage traité impossible (${botLabel(bot)}):`, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Sert un message authentifié. Résout une fois le message réservé et mis en file sous le verrou de sa
 * conversation : le traitement lui-même (LLM, envois) est suivi par `tracker`, ce qui permet de traiter
 * en parallèle les conversations d'un même lot tout en gardant l'ordre au sein d'une conversation.
 */
export async function serveMessage(input: ServeInput, tracker: InFlightTracker): Promise<void> {
  const { bot, waNumber, message } = input;
  const label = botLabel(bot);
  const shortId = shortMessageId(message.messageId);

  const servable = await checkServable(bot);
  if (servable !== 'ok') {
    await countUnserved(bot, servable, message.messageId);
    return;
  }

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
  const key = `${waNumber}:${message.messageId}`;
  if (!(await claimMessage(key, CLAIM_STALE_AFTER_SECONDS))) {
    console.log(`[Pipeline] Doublon ignoré (${label}, ${shortId})`);
    return;
  }

  const work = withConversationLock(`${waNumber}|${message.contactId}`, async () => {
    try {
      await processLocked(input);
    } catch (err) {
      console.error(`[Pipeline] Échec du traitement (${label}, ${shortId}):`, err instanceof Error ? err.message : String(err));
    } finally {
      await completeQuietly(key, bot);
    }
  });
  void tracker.track(work).catch(() => undefined);
}

async function processLocked(input: ServeInput): Promise<void> {
  // Le transport authentifié avant le verrou est réutilisé tel quel : une rotation des identifiants pendant
  // l'attente n'est pas vue par ce message (acceptable en 2b-1 ; remplacé en 2b-2 par les transports par compte).
  const { bot: routedBot, transport, waNumber, message } = input;
  const shortId = shortMessageId(message.messageId);

  // Configuration relue : le message a pu attendre derrière le verrou pendant un changement de statut ou de numéro.
  const bot = findRoute(waNumber);
  if (!bot || bot.client_id !== routedBot.client_id || bot.bot_id !== routedBot.bot_id || bot.transport !== routedBot.transport) {
    console.warn(`[Pipeline] Routage modifié pendant l'attente (${botLabel(routedBot)}, ${shortId}), message écarté`);
    return;
  }
  const servable = await checkServable(bot);
  if (servable !== 'ok') {
    await countUnserved(bot, servable, message.messageId);
    return;
  }

  const isNewSession = await createSessionIfAbsent(waNumber, message.contactId, bot.client_id, bot.bot_id);
  if (isNewSession) console.log(`[Pipeline] Nouvelle session (${botLabel(bot)})`);
  else await touchSession(waNumber, message.contactId);

  const ctx: ConversationContext = {
    bot,
    transport,
    waNumber,
    contactId: message.contactId,
    messageId: message.messageId,
    ...(message.profileName ? { profileName: message.profileName } : {}),
  };

  if (message.kind === 'audio' || message.kind === 'media' || message.kind === 'unsupported') {
    console.log(`[Pipeline] Message non texte (${botLabel(bot)}, type=${safeProviderType(message.providerType)})`);
    await sendFixedReply(ctx, message.kind === 'audio' ? AUDIO_REPLY : TEXT_ONLY_REPLY);
    return;
  }

  // Nouvelle session avec accueil : l'accueil part d'abord, puis le message est traité (audit 5.6).
  if (isNewSession && bot.welcome.enabled) {
    try {
      await handleWelcome(ctx);
    } catch (err) {
      if (err instanceof TransportSendError && err.kind === 'auth') {
        // Jeton refusé : la réponse échouerait aussi, inutile d'appeler le LLM.
        console.warn(`[Pipeline] Accueil refusé (jeton), message non traité (${botLabel(bot)}, ${shortId})`);
        return;
      }
      console.error(`[Pipeline] Accueil non envoyé (${botLabel(bot)}):`, err instanceof Error ? err.message : String(err));
    }
  }

  await handleMessage(ctx, message.text);
}
