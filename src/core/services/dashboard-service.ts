import type { Database, LeadRow } from '../database/types.js';
import type { CredentialsService } from './credentials-service.js';
import { notFound } from '../../api/errors.js';

export interface BotHealth {
  status: string;
  numbers: string[];
  languages: string[];
  whatsapp: { validated: boolean; validated_at: string | null; error: string | null };
  crm: { configured: boolean; connector: string | null; last_error: string | null; last_error_at: string | null };
  llm: { mode: string; key_configured: boolean };
}

export interface DashboardServiceDeps {
  db: Database;
  credentials: CredentialsService;
}

export class DashboardService {
  private readonly db: Database;
  private readonly credentials: CredentialsService;

  constructor(deps: DashboardServiceDeps) {
    this.db = deps.db;
    this.credentials = deps.credentials;
  }

  private async requireBot(clientId: string, botId: string) {
    const rec = await this.db.getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');
    return rec;
  }

  async listLeads(clientId: string, botId: string, q: { page: number; page_size: number; search?: string; rdv?: boolean }): Promise<{ leads: LeadRow[]; total: number; page: number; page_size: number }> {
    await this.requireBot(clientId, botId);
    const offset = (q.page - 1) * q.page_size;
    const { leads, total } = await this.db.listLeadsByBot(clientId, botId, {
      ...(q.search ? { search: q.search } : {}),
      ...(q.rdv ? { rdvOnly: true } : {}),
      limit: q.page_size,
      offset,
    });
    return { leads, total, page: q.page, page_size: q.page_size };
  }

  async getLead(clientId: string, botId: string, phone: string): Promise<{ phone: string; name: string | null; qualified_data: Record<string, unknown> | null; transcript: { role: string; content: string; created_at: string }[] }> {
    await this.requireBot(clientId, botId);
    const data = await this.db.getLeadData(phone, clientId, botId);
    if (data === null) throw notFound('Lead introuvable.');
    const history = await this.db.getRecentHistory(phone, clientId, botId, 200);
    const transcript = [...history].reverse();
    const name = (data['name'] as string | undefined) ?? (data['profileName'] as string | undefined) ?? null;
    return { phone, name, qualified_data: data, transcript };
  }

  async health(clientId: string, botId: string): Promise<BotHealth> {
    const rec = await this.requireBot(clientId, botId);
    const allNumbers = await this.db.listBotNumbers();
    const numbers = allNumbers
      .filter((n) => n.client_id === clientId && n.bot_id === botId)
      .map((n) => n.whatsapp_number);
    const rt = await this.db.getBotRuntimeState(clientId, botId);
    const connector = rec.crm?.connector ?? null;
    const crmConfigured = connector
      ? (await this.credentials.getMasked(clientId, botId, 'crm', connector)).configured
      : false;
    const llmMode = rec.llm?.mode ?? 'platform';
    const llmKey = await this.credentials.getMasked(clientId, botId, 'llm', 'anthropic');
    return {
      status: rec.status,
      numbers,
      languages: rec.languages,
      whatsapp: {
        validated: Boolean(rt?.transport_validated_at),
        validated_at: rt?.transport_validated_at ?? null,
        error: rt?.transport_error ?? null,
      },
      crm: {
        configured: crmConfigured,
        connector,
        last_error: rt?.last_crm_error ?? null,
        last_error_at: rt?.last_crm_error_at ?? null,
      },
      llm: { mode: llmMode, key_configured: llmMode === 'byo' && llmKey.configured },
    };
  }
}
