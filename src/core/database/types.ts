// Shared types and Database interface for SQLite/Postgres abstraction

import type { AccountsStore, MembershipGrantRecord } from './accounts-types.js';

export type { AccountsStore, EntityRecord, EntityStatus, MembershipGrantRecord, MembershipRecord, MembershipRole, MembershipStatus } from './accounts-types.js';

export interface Session {
  /** Numéro WhatsApp destinataire de l'organisation, en E.164. */
  wa_number: string;
  /** Identifiant opaque du contact tel que fourni par le transport (jamais normalisé). */
  phone: string;
  client_id: string;
  bot_id: string;
  created_at: string;
  updated_at: string;
}

export interface HistoryRow {
  role: string;
  content: string;
  created_at: string;
}

export interface LeadRow {
  phone: string;
  client_id: string;
  bot_id: string;
  name: string | null;
  qualified_data: string | null;
  rdv_requested: number;
  created_at: string;
  message_count: number;
  last_message_at: string | null;
}

export interface LeadListResult {
  leads: LeadRow[];
  total: number;
}

export interface CredentialRecord {
  client_id: string;
  bot_id: string | null;
  service: string;
  provider: string;
  mode: string;
  secret_encrypted: string;
  key_version: number;
}

export interface PlatformKeyRecord {
  id: number;
  label: string;
  secret_encrypted: string;
  key_version: number;
  active: boolean;
}

export interface PlatformKeyInput {
  label: string;
  secret_encrypted: string;
  key_version: number;
  active: boolean;
}

export type Localized = Record<string, string>;

export interface ClientRecord {
  client_id: string;
  name: string;
  status: string;
}

export interface PersonalityFields {
  role: string;
  tones: string[];
  objective: string;
  info: string;
}

export interface BotRecord {
  client_id: string;
  bot_id: string;
  name: string;
  transport: string;
  status: string;
  default_language: string;
  languages: string[];
  system_prompt: Localized;
  lead_fields: string;
  welcome: { enabled: boolean; message: Localized };
  error_messages: Localized;
  catalog: { meta_catalog_id?: string } | null;
  llm: { model?: string; mode?: string } | null;
  crm: { connector: string } | null;
  personality: Record<string, PersonalityFields> | null;
  /** Entité de rattachement. Nullable en base ; l'obligation est applicative. */
  entity_id: number | null;
}

export interface BotNumberRecord {
  whatsapp_number: string;
  client_id: string;
  bot_id: string;
}

export interface LlmPricingRecord {
  id: number; model: string;
  input_per_mtok: number; output_per_mtok: number;
  cache_read_per_mtok: number; cache_write_per_mtok: number;
  currency: string; effective_from: string; effective_to: string | null;
}

export interface LlmPricingInput {
  model: string; input_per_mtok: number; output_per_mtok: number;
  cache_read_per_mtok: number; cache_write_per_mtok: number; currency: string;
}

export interface LlmUsageInput {
  client_id: string; bot_id: string | null; phone: string | null;
  call_type: string; mode: string; platform_key_id: number | null;
  model: string;
  input_tokens: number; output_tokens: number;
  cache_read_tokens: number; cache_creation_tokens: number;
  cost_usd: number; pricing_version: number | null;
  anthropic_request_id: string | null;
}

export interface LlmUsageRow extends LlmUsageInput { id: number; created_at: string; }

export interface UserRecord {
  id: number;
  email: string;
  password_hash: string | null;
  role: string;
  /** Hérité : conservé en base pour la migration, n'est plus lu par le modèle de comptes. */
  client_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface UserInput {
  email: string;
  password_hash: string | null;
  role: string;
  client_id: string | null;
  status: string;
}

export interface InvitationRecord {
  id: number;
  email: string;
  client_id: string | null;
  role: string;
  token_hash: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  /** Appartenances à créer à l'acceptation ; null pour une invitation antérieure au modèle de comptes. */
  grants: MembershipGrantRecord[] | null;
}

export interface InvitationInput {
  email: string;
  client_id: string | null;
  role: string;
  token_hash: string;
  expires_at: string;
  grants?: MembershipGrantRecord[] | null;
}

export interface AuthSessionRecord {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface AuthSessionInput {
  user_id: number;
  token_hash: string;
  expires_at: string;
}

export interface PasswordResetRecord {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface PasswordResetInput {
  user_id: number;
  token_hash: string;
  expires_at: string;
}

export interface ConnectorMappingInput {
  client_id: string;
  bot_id: string | null;
  connector: string;
  mapping: Record<string, unknown>;
}

export interface ConnectorMappingRecord extends ConnectorMappingInput {
  id: number;
  created_at: string;
  updated_at: string;
}

export interface BotMetrics {
  leads_total: number;
  rdv_total: number;
  conversations_total: number;
  messages_total: number;
}

export interface AuditLogInput {
  actor_user_id: number | null;
  action: string;
  target: string;
  client_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AuditLogRow extends AuditLogInput {
  id: number;
  created_at: string;
}

export interface BotRuntimeStateRecord {
  client_id: string;
  bot_id: string;
  transport_validated_at: string | null;
  transport_error: string | null;
  last_crm_error: string | null;
  last_crm_error_at: string | null;
  unserved_count: number;
  unserved_last_at: string | null;
  updated_at: string;
}

// Database driver interface: all methods are async
/**
 * Durée de conservation des clés de dédoublonnage (`processed_messages`), en heures (7 jours).
 * `cleanupProcessedMessages` purge au-delà ; `MESSAGE_MAX_AGE_HOURS` doit rester strictement en dessous,
 * sinon un webhook rejoué après la purge de sa clé repasserait le dédoublonnage (revue finale m5).
 */
export const PROCESSED_MESSAGES_RETENTION_HOURS = 168;

export interface Database extends AccountsStore {
  // Sessions
  getSession(waNumber: string, contactId: string): Promise<Session | undefined>;
  /** Crée la session si absente (une seule requête atomique) ; true si elle vient d'être créée. Ne réassigne jamais une session existante. */
  createSessionIfAbsent(waNumber: string, contactId: string, clientId: string, botId: string): Promise<boolean>;
  touchSession(waNumber: string, contactId: string): Promise<void>;
  /** Supprime les sessions sans activité depuis plus de `days` jours ; renvoie le nombre supprimé. */
  purgeInactiveSessions(days: number): Promise<number>;

  // Conversations
  getConversation(phone: string, clientId: string, botId: string, limit?: number): Promise<{ role: string; content: string }[]>;
  addMessage(phone: string, clientId: string, botId: string, role: 'user' | 'assistant', content: string): Promise<void>;
  getRecentHistory(phone: string, clientId: string, botId: string, limit?: number): Promise<HistoryRow[]>;

  // Leads
  saveLead(phone: string, clientId: string, botId: string, data: Record<string, unknown>): Promise<void>;
  getLeadData(phone: string, clientId: string, botId: string): Promise<Record<string, unknown> | null>;
  listLeadsByBot(clientId: string, botId: string, opts: { search?: string; rdvOnly?: boolean; limit: number; offset: number }): Promise<LeadListResult>;

  // Message dedup en deux temps : réclamation atomique puis fin de traitement.
  // claimMessage : true si la clé est nouvelle, ou en état 'processing' depuis au moins staleAfterSeconds
  // (traitement interrompu, reprise permise) ; false sinon.
  claimMessage(key: string, staleAfterSeconds: number): Promise<boolean>;
  completeMessage(key: string): Promise<void>;
  // Purge les clés plus vieilles que PROCESSED_MESSAGES_RETENTION_HOURS.
  cleanupProcessedMessages(): Promise<void>;

  // Maintenance
  purgeOldConversations(days?: number): Promise<void>;

  // Credentials par tenant (chiffrés)
  getCredential(clientId: string, botId: string | null, service: string, provider: string): Promise<CredentialRecord | undefined>;
  upsertCredential(rec: CredentialRecord): Promise<void>;
  listCredentials(clientId: string): Promise<CredentialRecord[]>;

  // Pool de clés LLM plateforme (infra, chiffrées)
  listActivePlatformKeys(): Promise<PlatformKeyRecord[]>;
  upsertPlatformKey(rec: PlatformKeyInput): Promise<void>;

  // Configuration des bots (migrée depuis les fichiers JSON)
  listClients(): Promise<ClientRecord[]>;
  upsertClient(rec: ClientRecord): Promise<void>;
  getBotRecord(clientId: string, botId: string): Promise<BotRecord | undefined>;
  listBotRecords(): Promise<BotRecord[]>;
  upsertBotRecord(rec: BotRecord): Promise<void>;
  deleteBotRecord(clientId: string, botId: string): Promise<void>;
  listBotNumbers(): Promise<BotNumberRecord[]>;
  setBotNumbers(clientId: string, botId: string, numbers: string[]): Promise<void>;

  // Metering LLM
  getLlmPricing(model: string): Promise<LlmPricingRecord | undefined>;
  upsertLlmPricing(rec: LlmPricingInput): Promise<void>;
  insertLlmUsage(rec: LlmUsageInput): Promise<void>;
  listLlmUsage(clientId: string): Promise<LlmUsageRow[]>;
  getBotMetrics(clientId: string, botId: string): Promise<BotMetrics>;
  listLlmUsageByBot(clientId: string, botId: string, sinceIso?: string): Promise<LlmUsageRow[]>;

  // Auth: users / invitations / sessions / password resets
  createUser(input: UserInput): Promise<UserRecord>;
  getUserByEmail(email: string): Promise<UserRecord | undefined>;
  getUserById(id: number): Promise<UserRecord | undefined>;
  updateUserPassword(id: number, passwordHash: string): Promise<void>;
  setUserStatus(id: number, status: string): Promise<void>;
  getClient(clientId: string): Promise<ClientRecord | undefined>;
  createInvitation(input: InvitationInput): Promise<InvitationRecord>;
  getInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | undefined>;
  markInvitationAccepted(id: number): Promise<void>;
  listInvitations(clientId: string): Promise<InvitationRecord[]>;
  deleteInvitation(id: number): Promise<void>;
  createAuthSession(input: AuthSessionInput): Promise<AuthSessionRecord>;
  getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | undefined>;
  revokeAuthSession(id: number): Promise<void>;
  revokeAllUserSessions(userId: number): Promise<void>;
  createPasswordReset(input: PasswordResetInput): Promise<PasswordResetRecord>;
  getPasswordResetByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined>;
  markPasswordResetUsed(id: number): Promise<void>;

  // Mappings CRM (migrés depuis connectors-config/*.json)
  getConnectorMapping(clientId: string, botId: string | null, connector: string): Promise<ConnectorMappingRecord | undefined>;
  upsertConnectorMapping(rec: ConnectorMappingInput): Promise<void>;
  listConnectorMappings(clientId: string): Promise<ConnectorMappingRecord[]>;

  // Journal d'audit des mutations admin
  insertAuditLog(rec: AuditLogInput): Promise<void>;
  listAuditLog(clientId: string, limit?: number): Promise<AuditLogRow[]>;

  // État runtime par bot (validation transport, etc.)
  getBotRuntimeState(clientId: string, botId: string): Promise<BotRuntimeStateRecord | undefined>;
  setTransportValidation(clientId: string, botId: string, validatedAt: string | null, error: string | null): Promise<void>;
  setLastCrmError(clientId: string, botId: string, error: string | null): Promise<void>;
  incrementUnserved(clientId: string, botId: string): Promise<void>;

  // Lifecycle
  close(): Promise<void>;
}
