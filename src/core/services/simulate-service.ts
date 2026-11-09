import { randomUUID } from 'crypto';
import { chatWithModel, type ChatMessage } from '../../llm/anthropic.js';
import { getDatabase } from '../database/index.js';
import { config } from '../config.js';
import { BOT_NOT_FOUND, notFound } from '../../api/errors.js';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

interface SimSession {
  key: string;
  messages: ChatMessage[];
  expiresAt: number;
}

export interface SimulateServiceDeps {
  chatFn?: typeof chatWithModel;
  ttlMs?: number;
}

export class SimulateService {
  private readonly chatFn: typeof chatWithModel;
  private readonly ttlMs: number;
  private readonly sessions = new Map<string, SimSession>();

  constructor(deps: SimulateServiceDeps = {}) {
    this.chatFn = deps.chatFn ?? chatWithModel;
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  }

  private sweep(now: number): void {
    for (const [id, s] of this.sessions) {
      if (s.expiresAt <= now) this.sessions.delete(id);
    }
  }

  async simulate(
    clientId: string,
    botId: string,
    input: { session_id?: string; message: string; use_bot_config?: boolean },
  ): Promise<{ session_id: string; reply: string; model: string }> {
    const rec = await getDatabase().getBotRecord(clientId, botId);
    if (!rec) throw notFound(BOT_NOT_FOUND);

    const now = Date.now();
    this.sweep(now);
    const key = `${clientId}/${botId}`;

    let id = input.session_id;
    let session = id ? this.sessions.get(id) : undefined;
    if (!session || session.key !== key || session.expiresAt <= now) {
      id = randomUUID();
      session = { key, messages: [], expiresAt: now + this.ttlMs };
      this.sessions.set(id, session);
    }

    session.messages.push({ role: 'user', content: input.message });

    // system prompt : langue par defaut, fallback premiere valeur, placeholders neutralises
    const promptByLang = rec.system_prompt as Record<string, string>;
    const rawPrompt = promptByLang[rec.default_language] ?? Object.values(promptByLang)[0] ?? '';
    const basePrompt = rawPrompt
      .replace(/\{\{BASE_URL\}\}/g, config.baseUrl)
      .replace(/\{\{PHONE\}\}/g, 'simulateur');

    // Mêmes modèles que pour un vrai contact (cascade, ou modèle imposé à l'agent IA), pour que le test
    // reflète ce que vivra le client. Par défaut, le test passe par les clés de la plateforme.
    const useBotConfig = input.use_bot_config === true;
    const botModel = (rec.llm?.model as string | undefined);
    const chatOpts = {
      clientId, botId,
      ...(botModel ? { model: botModel } : {}),
      ...(useBotConfig ? {} : { mode: 'platform' as const }),
    };

    const { text: reply, model } = await this.chatFn(
      [{ text: basePrompt, cache: true }],
      [...session.messages],
      chatOpts,
    );

    session.messages.push({ role: 'assistant', content: reply });
    session.expiresAt = now + this.ttlMs;

    return { session_id: id!, reply, model };
  }
}
