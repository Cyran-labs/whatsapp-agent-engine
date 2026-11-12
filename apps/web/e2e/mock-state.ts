/** État en mémoire du faux moteur : fixtures et remise à zéro (`POST /__reset`). */

import type {
  MetaHealthView,
  WhatsAppAccountAlertView,
  WhatsAppAccountDisconnected,
  WhatsAppAccountErrorReasonView,
  WhatsAppAccountModeView,
  WhatsAppAccountStateView,
  WhatsAppWebhooksView,
} from '@wabagent/contracts';

/**
 * Réponse d'erreur imposée à une route du moteur (`POST /__fail`) : le corps a la forme du moteur
 * (`{ error: { code, message, request_id, details?, reason? } }`). `method` nul : toutes les méthodes. `times` nul :
 * jusqu'au prochain `__reset`, sinon le nombre de réponses restantes (une réponse forcée une fois laisse la suite réussir).
 */
export interface ForcedResponse {
  route: string;
  method: string | null;
  status: number;
  code: string;
  message: string;
  reason: string | null;
  details: { path: string; message: string; provider_text?: string }[] | null;
  request_id: string;
  times: number | null;
}

export interface Account { id: number; email: string; password: string }
export interface Org { client_id: string; name: string; status?: 'suspended' }
export interface Entity { id: number; client_id: string; name: string; status: 'active' | 'archived' }
export interface Grant { entity_id: number | null; role: string; read_only: boolean }
export interface Membership extends Grant { user_id: number; client_id: string; status: 'active' | 'suspended' }
export interface Bot {
  client_id: string;
  bot_id: string;
  name: string;
  slug: string;
  status: string;
  languages: string[];
  default_language: string;
  system_prompt: Record<string, string>;
  entity_id: number;
  /** Liste d'accès limité (E.164 ou BSUID, normalisée). Le numéro branché se lit côté `WhatsAppNumber.bot_id`. */
  allowlist: string[];
  status_reason: string | null;
  unserved: { count: number; last_at: string | null };
}

/** Compte WhatsApp d'une organisation. Le webhook est stocké en clair : le faux moteur ne chiffre rien. */
export interface WhatsAppAccount {
  id: number;
  client_id: string;
  name: string;
  mode: WhatsAppAccountModeView;
  provider_account_id: string;
  waba_id: string | null;
  meta_app_id: string | null;
  state: WhatsAppAccountStateView;
  error_reason: WhatsAppAccountErrorReasonView | null;
  /** Motif enregistré du passage en erreur (texte du moteur), null hors erreur. */
  error_detail: string | null;
  /** Message du fournisseur tel qu'il l'a écrit, null si le motif est un texte du moteur. */
  provider_text: string | null;
  last_verified_at: string | null;
  token_expiry: string | null;
  secret_checked_at: string | null;
  alerts: WhatsAppAccountAlertView[];
  /** Clé d'URL et jeton du compte. Servis par `GET /:id/webhook` pour CM.com seulement (lot R1 : 404 pour Meta). */
  webhook: { path: string; url: string | null; verify_token: string | null };
  /** Webhooks inscrits chez Meta tels que le faux Meta les relit (lot R1) ; null pour CM.com. */
  webhooks: WhatsAppWebhooksView | null;
  /** État du compte lu chez le faux Meta ; null quand il n'est pas lu. */
  meta_health: MetaHealthView | null;
  /** Bilan que le faux Meta donne au retrait d'un compte Meta (`POST /:id/disconnect`). */
  disconnect_outcome: WhatsAppAccountDisconnected;
}

/** Webhooks d'un compte Meta raccordé par le lot R1 : WABA et app inscrites. */
export const webhooksOk = (checkedAt: string): WhatsAppWebhooksView => ({ waba: 'ok', app: 'ok', app_host: null, checked_at: checkedAt });
/** Retrait ordinaire d'un compte Meta : adresse enlevée chez Meta, webhook de l'app pointé ailleurs que sur ce compte. */
export const DISCONNECT_CLEAN: WhatsAppAccountDisconnected = { waba_cleanup: 'done', app_webhook: 'not_applicable' };

export interface WhatsAppNumber {
  id: number;
  client_id: string;
  account_id: number;
  phone_e164: string;
  display_name: string;
  meta_status: string | null;
  quality: string | null;
  is_test: boolean;
  provider_state: 'present' | 'removed';
  removed_at: string | null;
  delivery_failures: number;
  last_delivery_error_code: number | null;
  /** Agent IA branché sur ce numéro (1 numéro = 1 agent IA), de la même organisation. */
  bot_id: string | null;
}
export interface Invitation {
  id: number;
  client_id: string;
  email: string;
  token: string;
  grants: Grant[];
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface State {
  accounts: Account[];
  orgs: Org[];
  entities: Entity[];
  memberships: Membership[];
  bots: Bot[];
  whatsappAccounts: WhatsAppAccount[];
  whatsappNumbers: WhatsAppNumber[];
  invitations: Invitation[];
  /** Jetons de réinitialisation valides : jeton vers identifiant de compte. */
  resetTokens: Map<string, number>;
  /** Dernier lien de réinitialisation « envoyé par e-mail » (chemin relatif), lu via `GET /__last-reset-link`. */
  lastResetLink: string | null;
  /** Réponses forcées (refus ou panne) posées via `POST /__fail`, dans l'ordre de pose, effacées par `__reset`. */
  forced: ForcedResponse[];
  /** Moteur injoignable (`POST /__unreachable`) : toute route du moteur coupe la connexion sans répondre, jusqu'au `__reset`. */
  unreachable: boolean;
  /** Nom du lead renvoyé par `GET /bots/:botId/leads` ; nul (scénario `unnamed-lead`) : la ligne affiche le numéro. */
  leadName: string | null;
  nextIds: { account: number; entity: number; invitation: number; reset: number; whatsappAccount: number; whatsappNumber: number };
}

export const RESET_TOKEN = 'reset-ok';

function grant(entity_id: number | null, role: string, read_only = false): Grant {
  return { entity_id, role, read_only };
}

/**
 * c1 « Maison Lumière » : demo en admin, advisor en conseiller (entité 1).
 * c2 « Atelier Nord » : demo en conseiller (entité 2).
 * invite-new : compte neuf pour c1 ; invite-existing : advisor invité dans c2.
 * c3 « Studio Ocre » est suspendue : demo y est admin (listée `status: 'suspended'`, jamais ouvrable), suspendu y est
 * l'unique membre et n'a donc aucune organisation ouvrable.
 * WhatsApp : c1 a le compte « Boutique principale » (3 numéros, `demo-1` branché sur le premier, le troisième est un
 * numéro de test) ; c2 a son propre compte et son numéro, jamais visibles depuis c1. `demo-3` (c1) est en brouillon
 * sans numéro.
 */
export function initialState(): State {
  return {
    accounts: [
      { id: 1, email: 'demo@wabagent.test', password: 'motdepasse12' },
      { id: 2, email: 'advisor@wabagent.test', password: 'motdepasse12' },
      { id: 3, email: 'suspendu@wabagent.test', password: 'motdepasse12' },
    ],
    orgs: [
      { client_id: 'c1', name: 'Maison Lumière' },
      { client_id: 'c2', name: 'Atelier Nord' },
      { client_id: 'c3', name: 'Studio Ocre', status: 'suspended' },
    ],
    entities: [
      { id: 1, client_id: 'c1', name: 'Boutique Paris', status: 'active' },
      { id: 2, client_id: 'c2', name: 'Atelier', status: 'active' },
    ],
    memberships: [
      { user_id: 1, client_id: 'c1', status: 'active', ...grant(null, 'admin') },
      { user_id: 1, client_id: 'c2', status: 'active', ...grant(2, 'advisor') },
      { user_id: 2, client_id: 'c1', status: 'active', ...grant(1, 'advisor') },
      { user_id: 1, client_id: 'c3', status: 'active', ...grant(null, 'admin') },
      { user_id: 3, client_id: 'c3', status: 'active', ...grant(null, 'admin') },
    ],
    bots: [
      { client_id: 'c1', bot_id: 'demo-1', name: 'Support technique', slug: 'support-technique', status: 'active', languages: ['fr'], default_language: 'fr', system_prompt: { fr: 'Tu es un agent de support.' }, entity_id: 1, allowlist: [], status_reason: null, unserved: { count: 0, last_at: null } },
      { client_id: 'c2', bot_id: 'demo-2', name: 'Assistant atelier', slug: 'assistant-atelier', status: 'draft', languages: ['fr'], default_language: 'fr', system_prompt: { fr: 'Tu aides les clients.' }, entity_id: 2, allowlist: [], status_reason: null, unserved: { count: 0, last_at: null } },
      { client_id: 'c1', bot_id: 'demo-3', name: 'Accueil boutique', slug: 'accueil-boutique', status: 'draft', languages: ['fr'], default_language: 'fr', system_prompt: { fr: 'Tu accueilles les clients de la boutique.' }, entity_id: 1, allowlist: [], status_reason: null, unserved: { count: 0, last_at: null } },
    ],
    whatsappAccounts: [
      {
        id: 1, client_id: 'c1', name: 'Boutique principale', mode: 'meta_manual', provider_account_id: '104829371625544', waba_id: '104829371625544', meta_app_id: '1424483510748297',
        state: 'connected', error_reason: null, error_detail: null, provider_text: null, last_verified_at: '2026-11-08T10:00:00.000Z', token_expiry: 'never', secret_checked_at: '2026-11-09T08:30:00.000Z', alerts: [],
        webhook: { path: '/webhook/meta/cle-demo', url: 'https://dev.wabagent.com/webhook/meta/cle-demo', verify_token: 'vt-demo-1234' },
        webhooks: webhooksOk('2026-11-08T10:00:00.000Z'), meta_health: null, disconnect_outcome: DISCONNECT_CLEAN,
      },
      {
        id: 2, client_id: 'c2', name: 'Atelier Nord', mode: 'meta_manual', provider_account_id: '208374650192837', waba_id: '208374650192837', meta_app_id: '1424483510748298',
        state: 'connected', error_reason: null, error_detail: null, provider_text: null, last_verified_at: '2026-11-08T10:00:00.000Z', token_expiry: 'never', secret_checked_at: '2026-11-09T08:30:00.000Z', alerts: [],
        webhook: { path: '/webhook/meta/cle-atelier', url: 'https://dev.wabagent.com/webhook/meta/cle-atelier', verify_token: 'vt-atelier-5678' },
        webhooks: webhooksOk('2026-11-08T10:00:00.000Z'), meta_health: null, disconnect_outcome: DISCONNECT_CLEAN,
      },
    ],
    whatsappNumbers: [
      { id: 1, client_id: 'c1', account_id: 1, phone_e164: '+33184801234', display_name: 'Boutique Paris', meta_status: 'CONNECTED', quality: 'GREEN', is_test: false, provider_state: 'present', removed_at: null, delivery_failures: 0, last_delivery_error_code: null, bot_id: 'demo-1' },
      { id: 2, client_id: 'c1', account_id: 1, phone_e164: '+33612457890', display_name: 'Service client', meta_status: 'CONNECTED', quality: 'GREEN', is_test: false, provider_state: 'present', removed_at: null, delivery_failures: 0, last_delivery_error_code: null, bot_id: null },
      { id: 3, client_id: 'c1', account_id: 1, phone_e164: '+15551649072', display_name: 'Numéro de test', meta_status: 'CONNECTED', quality: null, is_test: true, provider_state: 'present', removed_at: null, delivery_failures: 0, last_delivery_error_code: null, bot_id: null },
      { id: 4, client_id: 'c2', account_id: 2, phone_e164: '+33955500123', display_name: 'Atelier Nord', meta_status: 'CONNECTED', quality: 'GREEN', is_test: false, provider_state: 'present', removed_at: null, delivery_failures: 0, last_delivery_error_code: null, bot_id: null },
    ],
    invitations: [
      { id: 1, client_id: 'c1', email: 'nouveau@wabagent.test', token: 'invite-new', grants: [grant(1, 'advisor')], expires_at: '2099-01-01T00:00:00.000Z', accepted_at: null, created_at: '2026-11-01T00:00:00.000Z' },
      { id: 2, client_id: 'c2', email: 'advisor@wabagent.test', token: 'invite-existing', grants: [grant(2, 'manager')], expires_at: '2099-01-01T00:00:00.000Z', accepted_at: null, created_at: '2026-11-01T00:00:00.000Z' },
    ],
    resetTokens: new Map([[RESET_TOKEN, 1]]),
    lastResetLink: null,
    forced: [],
    unreachable: false,
    leadName: 'Marie',
    nextIds: { account: 4, entity: 3, invitation: 3, reset: 1, whatsappAccount: 3, whatsappNumber: 5 },
  };
}
