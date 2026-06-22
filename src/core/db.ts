// Re-export from database abstraction layer
// All functions are now async — callers must use await

export { initDatabase, getDatabase } from './database/index.js';
export type { Database, Session, SessionRow, HistoryRow, LeadRow, CrossConversationRow } from './database/index.js';

import { getDatabase } from './database/index.js';

export const getSession = (phone: string) => getDatabase().getSession(phone);
export const createSession = (phone: string, clientId: string, botId: string) => getDatabase().createSession(phone, clientId, botId);
export const getAllSessions = () => getDatabase().getAllSessions();
export const getConversation = (phone: string, clientId: string, botId: string, limit?: number) => getDatabase().getConversation(phone, clientId, botId, limit);
export const addMessage = (phone: string, clientId: string, botId: string, role: 'user' | 'assistant', content: string) => getDatabase().addMessage(phone, clientId, botId, role, content);
export const getRecentHistory = (phone: string, clientId: string, botId: string, limit?: number) => getDatabase().getRecentHistory(phone, clientId, botId, limit);
export const resetSession = (phone: string) => getDatabase().resetSession(phone);
export const resetBotSession = (phone: string, clientId: string, botId: string) => getDatabase().resetBotSession(phone, clientId, botId);
export const resetAll = (phone: string) => getDatabase().resetAll(phone);
export const getCrossConversations = (phone: string, currentClientId: string, currentBotId: string, limit?: number) => getDatabase().getCrossConversations(phone, currentClientId, currentBotId, limit);
export const saveLead = (phone: string, clientId: string, botId: string, data: Record<string, unknown>) => getDatabase().saveLead(phone, clientId, botId, data);
export const getLeadData = (phone: string, clientId: string, botId: string) => getDatabase().getLeadData(phone, clientId, botId);
export const getAllLeads = () => getDatabase().getAllLeads();
export const setLastCrmError = (clientId: string, botId: string, error: string | null) => getDatabase().setLastCrmError(clientId, botId, error);
export const isMessageProcessed = (messageId: string) => getDatabase().isMessageProcessed(messageId);
export const markMessageProcessed = (messageId: string) => getDatabase().markMessageProcessed(messageId);
export const cleanupProcessedMessages = () => getDatabase().cleanupProcessedMessages();
export const purgeOldConversations = (days?: number) => getDatabase().purgeOldConversations(days);
