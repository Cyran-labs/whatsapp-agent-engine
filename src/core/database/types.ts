// Shared types and Database interface for SQLite/Postgres abstraction

export interface Session {
  phone: string;
  client_id: string;
  bot_id: string;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  phone: string;
  client_id: string;
  bot_id: string;
  updated_at: string;
  msg_count: number;
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

export interface CrossConversationRow {
  client_id: string;
  bot_id: string;
  role: string;
  content: string;
  created_at: string;
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

// Database driver interface — all methods are async
export interface Database {
  // Sessions
  getSession(phone: string): Promise<Session | undefined>;
  createSession(phone: string, clientId: string, botId: string): Promise<void>;
  getAllSessions(): Promise<SessionRow[]>;

  // Conversations
  getConversation(phone: string, clientId: string, botId: string, limit?: number): Promise<{ role: string; content: string }[]>;
  addMessage(phone: string, clientId: string, botId: string, role: 'user' | 'assistant', content: string): Promise<void>;
  getRecentHistory(phone: string, clientId: string, botId: string, limit?: number): Promise<HistoryRow[]>;

  // Reset
  resetSession(phone: string): Promise<void>;
  resetBotSession(phone: string, clientId: string, botId: string): Promise<void>;
  resetAll(phone: string): Promise<void>;

  // Cross-bot
  getCrossConversations(phone: string, currentClientId: string, currentBotId: string, limit?: number): Promise<CrossConversationRow[]>;

  // Leads
  saveLead(phone: string, clientId: string, botId: string, data: Record<string, unknown>): Promise<void>;
  getLeadData(phone: string, clientId: string, botId: string): Promise<Record<string, unknown> | null>;
  getAllLeads(): Promise<LeadRow[]>;

  // Message dedup
  isMessageProcessed(messageId: string): Promise<boolean>;
  markMessageProcessed(messageId: string): Promise<void>;
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

  // Lifecycle
  close(): Promise<void>;
}
