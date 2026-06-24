import type { Database, BotRecord } from '../database/types.js';
import type { CreateBotInput, UpdateBotInput } from '@wabagent/contracts';
import { upsertBot } from '../config-store.js';
import { recordAudit } from '../audit.js';
import { conflict, notFound } from '../../api/errors.js';

export interface BotDetail extends BotRecord { numbers: string[]; }
export type BotSummary = BotDetail;

export interface BotServiceDeps { db: Database; }

function normalizeNumbers(numbers: string[]): string[] {
  return numbers.map((n) => n.replace(/\D/g, '')).filter(Boolean);
}

function inputToRecord(clientId: string, input: CreateBotInput): BotRecord {
  return {
    client_id: clientId,
    bot_id: input.bot_id,
    name: input.name,
    transport: input.transport,
    status: 'draft',
    default_language: input.default_language,
    languages: input.languages,
    system_prompt: input.system_prompt,
    lead_fields: input.lead_fields,
    welcome: input.welcome,
    error_messages: input.error_messages,
    catalog: input.catalog,
    llm: input.llm,
    crm: input.crm,
  };
}

export class BotService {
  private readonly db: Database;
  constructor(deps: BotServiceDeps) { this.db = deps.db; }

  private async numbersOf(clientId: string, botId: string): Promise<string[]> {
    return (await this.db.listBotNumbers())
      .filter((n) => n.client_id === clientId && n.bot_id === botId)
      .map((n) => n.whatsapp_number);
  }

  private async detail(rec: BotRecord): Promise<BotDetail> {
    return { ...rec, numbers: await this.numbersOf(rec.client_id, rec.bot_id) };
  }

  async listBots(clientId: string): Promise<BotSummary[]> {
    const recs = (await this.db.listBotRecords()).filter((r) => r.client_id === clientId);
    return Promise.all(recs.map((r) => this.detail(r)));
  }

  async getBot(clientId: string, botId: string): Promise<BotDetail> {
    const rec = await this.db.getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');
    return this.detail(rec);
  }

  async createBot(clientId: string, actorUserId: number | null, input: CreateBotInput): Promise<BotDetail> {
    if (await this.db.getBotRecord(clientId, input.bot_id)) throw conflict('bot_id déjà pris.');
    const rec = inputToRecord(clientId, input);
    await upsertBot(rec, []);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'bot.create', target: `bot:${clientId}/${rec.bot_id}`, client_id: clientId, metadata: { name: rec.name } });
    return this.detail(rec);
  }

  async updateBot(clientId: string, botId: string, actorUserId: number | null, patch: UpdateBotInput): Promise<BotDetail> {
    const existing = await this.db.getBotRecord(clientId, botId);
    if (!existing) throw notFound('Bot introuvable.');
    const merged: BotRecord = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.transport !== undefined ? { transport: patch.transport } : {}),
      ...(patch.default_language !== undefined ? { default_language: patch.default_language } : {}),
      ...(patch.languages !== undefined ? { languages: patch.languages } : {}),
      ...(patch.system_prompt !== undefined ? { system_prompt: patch.system_prompt } : {}),
      ...(patch.lead_fields !== undefined ? { lead_fields: patch.lead_fields } : {}),
      ...(patch.welcome !== undefined ? { welcome: patch.welcome } : {}),
      ...(patch.error_messages !== undefined ? { error_messages: patch.error_messages } : {}),
      ...(patch.catalog !== undefined ? { catalog: patch.catalog } : {}),
      ...(patch.llm !== undefined ? { llm: patch.llm } : {}),
      ...(patch.crm !== undefined ? { crm: patch.crm } : {}),
    };
    const numbers = await this.numbersOf(clientId, botId);
    await upsertBot(merged, numbers);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'bot.update', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: null });
    return this.detail(merged);
  }

  async setStatus(clientId: string, botId: string, actorUserId: number | null, status: string): Promise<BotDetail> {
    const existing = await this.db.getBotRecord(clientId, botId);
    if (!existing) throw notFound('Bot introuvable.');
    const numbers = await this.numbersOf(clientId, botId);
    if (status === 'active') {
      if (numbers.length === 0) {
        throw conflict('Au moins un numéro WhatsApp est requis pour activer.');
      }
      const rt = await this.db.getBotRuntimeState(clientId, botId);
      if (!rt?.transport_validated_at) {
        throw conflict('Le transport WhatsApp doit être validé avant activation.');
      }
    }
    const updated: BotRecord = { ...existing, status };
    await upsertBot(updated, numbers);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'bot.status', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { status } });
    return this.detail(updated);
  }

  async setNumbers(clientId: string, botId: string, actorUserId: number | null, numbers: string[]): Promise<BotDetail> {
    const existing = await this.db.getBotRecord(clientId, botId);
    if (!existing) throw notFound('Bot introuvable.');
    const normalized = normalizeNumbers(numbers);
    const all = await this.db.listBotNumbers();
    for (const num of normalized) {
      const owner = all.find((n) => n.whatsapp_number === num);
      if (owner && !(owner.client_id === clientId && owner.bot_id === botId)) {
        throw conflict('Numéro déjà routé vers un autre bot.');
      }
    }
    await upsertBot(existing, normalized);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'bot.numbers', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { count: normalized.length } });
    return this.detail(existing);
  }
}
