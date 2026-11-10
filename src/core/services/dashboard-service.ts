import type { Database, LeadRow, BotMetrics } from '../database/types.js';
import type { CredentialsService } from './credentials-service.js';
import { botNotFound, forbidden, notFound } from '../../api/errors.js';
import { maskContactNumber, type BotNumberSummary } from '@wabagent/contracts';
import { canSeeContactNumbers, type Access } from '../auth/permissions.js';
import { loadBotNumberSummary } from './bot-number-summary.js';

export interface BotHealth {
  status: string;
  /** Motif d'une pause automatique (`BOT_PAUSE_REASONS` des contrats), null sinon. */
  status_reason: string | null;
  languages: string[];
  /** Numéro branché avec l'état affiché de son compte WhatsApp (signatures rejetées comprises), null sans numéro. */
  whatsapp: { number: BotNumberSummary | null };
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
    if (!rec) throw botNotFound();
    return rec;
  }

  /**
   * Leads d'un agent IA. Pour un membre qui ne voit pas les numéros des contacts en entier (spec navigation 9.2) :
   * `phone` et la copie du numéro que le moteur écrit dans les données du lead (`qualified_data.phone`, `handler.ts`)
   * sont masqués, et la recherche ne porte que sur le nom. Les autres champs libres de `qualified_data` ne sont pas
   * masqués par ce lot (chantier Conversations et leads).
   */
  async listLeads(clientId: string, botId: string, q: { page: number; page_size: number; search?: string; rdv?: boolean }, access: Access): Promise<{ leads: Array<Omit<LeadRow, 'qualified_data'> & { qualified_data: Record<string, unknown> | null }>; total: number; page: number; page_size: number }> {
    const rec = await this.requireBot(clientId, botId);
    const seeNumbers = canSeeContactNumbers(access, rec.entity_id);
    const offset = (q.page - 1) * q.page_size;
    const { leads, total } = await this.db.listLeadsByBot(clientId, botId, {
      ...(q.search ? { search: { text: q.search, includePhone: seeNumbers } } : {}),
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
      if (seeNumbers) return { ...lead, qualified_data: qualifiedData };
      // Toute valeur non nulle est masquée : l'extraction LLM peut réécrire `phone` en nombre (revue tâche 3, M-1).
      const storedPhone = qualifiedData?.['phone'];
      const hasStoredPhone = storedPhone !== undefined && storedPhone !== null;
      return {
        ...lead,
        phone: maskContactNumber(lead.phone),
        qualified_data: qualifiedData && hasStoredPhone ? { ...qualifiedData, phone: maskContactNumber(String(storedPhone)) } : qualifiedData,
      };
    });

    return { leads: parsedLeads, total, page: q.page, page_size: q.page_size };
  }

  /**
   * Détail d'un lead (numéro en entier et tout l'historique) : refusé (403) à un membre qui ne voit pas les numéros des
   * contacts en entier, après le contrôle de l'agent IA (404 hors organisation) et avant toute lecture du lead, donc
   * même refus que le numéro soit un contact ou non (spec navigation 9.2).
   */
  async getLead(clientId: string, botId: string, phone: string, access: Access): Promise<{ phone: string; name: string | null; qualified_data: Record<string, unknown> | null; transcript: { role: string; content: string; created_at: string }[] }> {
    const rec = await this.requireBot(clientId, botId);
    if (!canSeeContactNumbers(access, rec.entity_id)) throw forbidden();
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
    const number = await loadBotNumberSummary(this.db, clientId, botId);
    const rt = await this.db.getBotRuntimeState(clientId, botId);
    const connector = rec.crm?.connector ?? null;
    const crmConfigured = connector
      ? (await this.credentials.getMasked(clientId, botId, 'crm', connector)).configured
      : false;
    const llmMode = rec.llm?.mode ?? 'platform';
    const llmKey = await this.credentials.getMasked(clientId, botId, 'llm', 'anthropic');
    return {
      status: rec.status,
      status_reason: rec.status_reason,
      languages: rec.languages,
      whatsapp: { number },
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
