// Re-export from database abstraction layer
// All functions are now async: callers must use await

export { initDatabase, getDatabase } from './database/index.js';
export type { Database, Session, HistoryRow, LeadRow } from './database/index.js';

import { getDatabase } from './database/index.js';

export const createSessionIfAbsent = (waNumber: string, contactId: string, clientId: string, botId: string) => getDatabase().createSessionIfAbsent(waNumber, contactId, clientId, botId);
export const touchSession = (waNumber: string, contactId: string) => getDatabase().touchSession(waNumber, contactId);
export const getConversation = (phone: string, clientId: string, botId: string, limit?: number) => getDatabase().getConversation(phone, clientId, botId, limit);
export const addMessage = (phone: string, clientId: string, botId: string, role: 'user' | 'assistant', content: string) => getDatabase().addMessage(phone, clientId, botId, role, content);
export const getRecentHistory = (phone: string, clientId: string, botId: string, limit?: number) => getDatabase().getRecentHistory(phone, clientId, botId, limit);
export const saveLead = (phone: string, clientId: string, botId: string, data: Record<string, unknown>) => getDatabase().saveLead(phone, clientId, botId, data);
export const getLeadData = (phone: string, clientId: string, botId: string) => getDatabase().getLeadData(phone, clientId, botId);
export const setLastCrmError = (clientId: string, botId: string, error: string | null) => getDatabase().setLastCrmError(clientId, botId, error);
export const claimMessage = (key: string, staleAfterSeconds: number) => getDatabase().claimMessage(key, staleAfterSeconds);
export const completeMessage = (key: string) => getDatabase().completeMessage(key);
export const incrementUnserved = (clientId: string, botId: string) => getDatabase().incrementUnserved(clientId, botId);
