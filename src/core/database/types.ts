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

  // Lifecycle
  close(): Promise<void>;
}
