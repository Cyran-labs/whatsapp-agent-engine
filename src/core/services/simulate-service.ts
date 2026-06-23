import { randomUUID } from 'crypto';
import { chat, type ChatMessage } from '../../llm/anthropic.js';
import { getDatabase } from '../database/index.js';
import { config } from '../config.js';
import { notFound } from '../../api/errors.js';

const SIMULATE_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TTL_MS = 30 * 60 * 1000;

interface SimSession {
  key: string;
  messages: ChatMessage[];
  expiresAt: number;
}

export interface SimulateServiceDeps {
  chatFn?: typeof chat;
  ttlMs?: number;
  model?: string;
}

export class SimulateService {
  private readonly chatFn: typeof chat;
  private readonly ttlMs: number;
  private readonly model: string;
  private readonly sessions = new Map<string, SimSession>();

  constructor(deps: SimulateServiceDeps = {}) {
    this.chatFn = deps.chatFn ?? chat;
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
    this.model = deps.model ?? SIMULATE_MODEL;
  }

  private sweep(now: number): void {
    for (const [id, s] of this.sessions) {
      if (s.expiresAt <= now) this.sessions.delete(id);
    }
  }

  async simulate(
    clientId: string,
    botId: string,
    input: { session_id?: string; message: string },
  ): Promise<{ session_id: string; reply: string; model: string }> {
    const rec = await getDatabase().getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');

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

    const reply = await this.chatFn(
      [{ text: basePrompt, cache: true }],
      [...session.messages],
      { clientId, botId, model: this.model },
    );

    session.messages.push({ role: 'assistant', content: reply });
    session.expiresAt = now + this.ttlMs;

    return { session_id: id!, reply, model: this.model };
  }
}
