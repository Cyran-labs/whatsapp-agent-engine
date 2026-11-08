import type { Database } from './database/types.js';

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CONVERSATION_DAYS = 90;
const DEFAULT_SESSION_DAYS = 30;

export interface MaintenanceOptions {
  intervalMs?: number;
  conversationDays?: number;
  sessionDays?: number;
}

/**
 * Purges périodiques (audit 6.6) : messages traités, conversations anciennes, sessions inactives.
 * Exécutées tout de suite puis à chaque intervalle (6 h par défaut). Une purge en échec est journalisée,
 * jamais levée, et n'empêche pas les suivantes. Un passage encore en cours n'est pas doublé.
 * Renvoie la fonction qui arrête le minuteur.
 */
export function startMaintenance(db: Database, opts: MaintenanceOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const conversationDays = opts.conversationDays ?? DEFAULT_CONVERSATION_DAYS;
  const sessionDays = opts.sessionDays ?? DEFAULT_SESSION_DAYS;
  let running = false;

  async function step(name: string, task: () => Promise<unknown>): Promise<void> {
    try {
      const result = await task();
      if (typeof result === 'number') console.log(`[Maintenance] ${name} : ${result} ligne(s) supprimée(s)`);
    } catch (err) {
      console.error(`[Maintenance] ${name} en échec :`, err instanceof Error ? err.message : String(err));
    }
  }

  async function runOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await step('Messages traités', () => db.cleanupProcessedMessages());
      await step('Conversations anciennes', () => db.purgeOldConversations(conversationDays));
      await step('Sessions inactives', () => db.purgeInactiveSessions(sessionDays));
    } finally {
      running = false;
    }
  }

  void runOnce();
  const timer = setInterval(() => { void runOnce(); }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
