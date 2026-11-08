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
 * Renvoie la fonction d'arrêt : elle annule le minuteur et résout à la fin du passage en cours, s'il y en a un,
 * pour que la base ne soit pas fermée sous une purge.
 */
export function startMaintenance(db: Database, opts: MaintenanceOptions = {}): () => Promise<void> {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const conversationDays = opts.conversationDays ?? DEFAULT_CONVERSATION_DAYS;
  const sessionDays = opts.sessionDays ?? DEFAULT_SESSION_DAYS;
  let current: Promise<void> | null = null;

  async function step(name: string, task: () => Promise<unknown>): Promise<void> {
    try {
      const result = await task();
      if (typeof result === 'number') console.log(`[Maintenance] ${name} : ${result} ligne(s) supprimée(s)`);
    } catch (err) {
      console.error(`[Maintenance] ${name} en échec :`, err instanceof Error ? err.message : String(err));
    }
  }

  async function pass(): Promise<void> {
    await step('Messages traités', () => db.cleanupProcessedMessages());
    await step('Conversations anciennes', () => db.purgeOldConversations(conversationDays));
    await step('Sessions inactives', () => db.purgeInactiveSessions(sessionDays));
  }

  function runOnce(): void {
    if (current) return;
    const running = pass().finally(() => { current = null; });
    current = running;
  }

  runOnce();
  const timer = setInterval(runOnce, intervalMs);
  timer.unref?.();
  return async () => {
    clearInterval(timer);
    if (current) await current;
  };
}
