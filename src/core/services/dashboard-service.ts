import type { Database, LeadRow, BotMetrics } from '../database/types.js';
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

  async listLeads(clientId: string, botId: string, q: { page: number; page_size: number; search?: string; rdv?: boolean }): Promise<{ leads: Array<Omit<LeadRow, 'qualified_data'> & { qualified_data: Record<string, unknown> | null }>; total: number; page: number; page_size: number }> {
    await this.requireBot(clientId, botId);
    const offset = (q.page - 1) * q.page_size;
    const { leads, total } = await this.db.listLeadsByBot(clientId, botId, {
      ...(q.search ? { search: q.search } : {}),
      ...(q.rdv ? { rdvOnly: true } : {}),
      limit: q.page_size,
      offset,
    });

    // Parse qualified_data from JSON string to object for API consistency
    const parsedLeads = leads.map((lead) => {
      let qualifiedData: Record<string, unknown> | null = null;
      if (typeof lead.qualified_data === 'string' && lead.qualified_data.length > 0) {
        try {
          qualifiedData = JSON.parse(lead.qualified_data) as Record<string, unknown>;
        } catch {
          qualifiedData = null;
        }
      } else if (lead.qualified_data && typeof lead.qualified_data === 'object') {
        qualifiedData = lead.qualified_data as Record<string, unknown>;
      }
      return {
        ...lead,
        qualified_data: qualifiedData,
      };
    });

    return { leads: parsedLeads, total, page: q.page, page_size: q.page_size };
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

  async metrics(clientId: string, botId: string): Promise<BotMetrics> {
    await this.requireBot(clientId, botId);
    return this.db.getBotMetrics(clientId, botId);
  }

  async usage(clientId: string, botId: string, sinceIso?: string): Promise<{
    totals: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; cost_usd: number; calls: number };
    by_model: { model: string; calls: number; cost_usd: number; input_tokens: number; output_tokens: number }[];
    by_day: { day: string; cost_usd: number; calls: number }[];
  }> {
    await this.requireBot(clientId, botId);
    const rows = await this.db.listLlmUsageByBot(clientId, botId, sinceIso);
    const totals = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 0, calls: 0 };
    const modelMap = new Map<string, { model: string; calls: number; cost_usd: number; input_tokens: number; output_tokens: number }>();
    const dayMap = new Map<string, { day: string; cost_usd: number; calls: number }>();
    for (const r of rows) {
      totals.input_tokens += r.input_tokens;
      totals.output_tokens += r.output_tokens;
      totals.cache_read_tokens += r.cache_read_tokens;
      totals.cache_creation_tokens += r.cache_creation_tokens;
      totals.cost_usd += r.cost_usd;
      totals.calls += 1;
      const m = modelMap.get(r.model) ?? { model: r.model, calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 };
      m.calls += 1;
      m.cost_usd += r.cost_usd;
      m.input_tokens += r.input_tokens;
      m.output_tokens += r.output_tokens;
      modelMap.set(r.model, m);
      const day = r.created_at.slice(0, 10);
      const d = dayMap.get(day) ?? { day, cost_usd: 0, calls: 0 };
      d.cost_usd += r.cost_usd;
      d.calls += 1;
      dayMap.set(day, d);
    }
    return {
      totals,
      by_model: [...modelMap.values()].sort((a, b) => b.cost_usd - a.cost_usd),
      by_day: [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    };
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
