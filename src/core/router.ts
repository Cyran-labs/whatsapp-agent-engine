import { getSession, createSession } from './db.js';
import { findBotByNumber, type BotConfig } from './bot-config.js';

export interface RouteResult {
  client_id: string;
  bot_id: string;
  config: BotConfig;
  is_new_session: boolean;
}

export async function routeIncomingMessage(
  fromPhone: string,
  toNumber: string
): Promise<RouteResult | null> {
  const session = await getSession(fromPhone);
  if (session) {
    try {
      const { loadBotConfig } = await import('./bot-config.js');
      const cfg = loadBotConfig(session.client_id, session.bot_id);
      return { client_id: cfg.client_id, bot_id: cfg.bot_id, config: cfg, is_new_session: false };
    } catch (err) {
      console.warn(`[Router] Existing session points to missing config (${session.client_id}/${session.bot_id}), falling back to number lookup`);
    }
  }

  const cfg = findBotByNumber(toNumber);
  if (!cfg) {
    console.warn(`[Router] No bot configured for incoming number ${toNumber}`);
    return null;
  }

  await createSession(fromPhone, cfg.client_id, cfg.bot_id);
  console.log(`[Router] New session: ${fromPhone} -> ${cfg.client_id}/${cfg.bot_id}`);
  return { client_id: cfg.client_id, bot_id: cfg.bot_id, config: cfg, is_new_session: true };
}
