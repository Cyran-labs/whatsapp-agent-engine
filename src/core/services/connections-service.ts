import type { Database } from '../database/types.js';
import type { CredentialsService } from './credentials-service.js';
import { recordAudit } from '../audit.js';
import { conflict, notFound, validationError } from '../../api/errors.js';
import { getCredentialRecord } from '../credentials/store.js';
import { decryptJson } from '../credentials/crypto.js';
import { createMetaCloudTransport } from '../../transport/meta-cloud.js';
import { createCmComTransport } from '../../transport/cm-com.js';
import type { Transport } from '../../transport/types.js';
import { createConnector } from '../../connectors/registry.js';
import { getMapping, upsertMapping, upsertBot } from '../config-store.js';
import type { FieldMapping } from '../../connectors/field-mapper.js';
import type { SetLlmInput } from '../../contracts/index.js';

export interface ConnectionsServiceDeps { db: Database; credentials: CredentialsService; }

export class ConnectionsService {
  private readonly db: Database;
  private readonly credentials: CredentialsService;
  constructor(deps: ConnectionsServiceDeps) { this.db = deps.db; this.credentials = deps.credentials; }

  private async requireBotTransport(clientId: string, botId: string): Promise<string> {
    const rec = await this.db.getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');
    return rec.transport;
  }

  async setTransport(clientId: string, botId: string, actorUserId: number | null, values: Record<string, string>): Promise<void> {
    const provider = await this.requireBotTransport(clientId, botId);
    await this.credentials.setCredentials(clientId, botId, 'transport', provider, values);
    await this.db.setTransportValidation(clientId, botId, null, null); // creds changées -> re-valider
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'transport.set', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { provider } });
  }

  async getTransportMasked(clientId: string, botId: string): Promise<{ configured: boolean; fields?: Record<string, string>; validated_at: string | null; error: string | null }> {
    const provider = await this.requireBotTransport(clientId, botId);
    const masked = await this.credentials.getMasked(clientId, botId, 'transport', provider);
    const rt = await this.db.getBotRuntimeState(clientId, botId);
    return { ...masked, validated_at: rt?.transport_validated_at ?? null, error: rt?.transport_error ?? null };
  }

  async validateTransport(clientId: string, botId: string, actorUserId: number | null): Promise<{ ok: boolean; error?: string }> {
    const provider = await this.requireBotTransport(clientId, botId);
    const rec = await getCredentialRecord(clientId, botId, 'transport', provider);
    if (!rec) throw conflict('Aucun identifiant transport configuré.');
    const creds = decryptJson(rec.secret_encrypted, rec.key_version) as Record<string, string>;

    let result: { ok: boolean; error?: string };
    try {
      const transport = this.buildTransport(provider, creds);
      result = transport.validateCredentials ? await transport.validateCredentials() : { ok: true };
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    await this.db.setTransportValidation(
      clientId,
      botId,
      result.ok ? new Date().toISOString() : null,
      result.ok ? null : (result.error ?? 'Validation échouée.'),
    );
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'transport.validate', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { ok: result.ok } });
    return result;
  }

  private buildTransport(provider: string, creds: Record<string, string>): Transport {
    if (provider === 'meta-cloud') {
      return createMetaCloudTransport({
        phoneNumberId: creds['phone_number_id'] ?? '',
        accessToken: creds['access_token'] ?? '',
        appSecret: creds['app_secret'] ?? '',
      });
    }
    if (provider === 'cm-com') {
      return createCmComTransport({
        productToken: creds['product_token'] ?? '',
        fromNumber: creds['from_number'] ?? '',
        serviceUrl: creds['service_url'] ?? '',
      });
    }
    throw new Error(`Transport inconnu: ${provider}`);
  }

  // ─── CRM ────────────────────────────────────────────────────────────────────

  async setCrm(clientId: string, botId: string, actorUserId: number | null, connector: string, values: Record<string, string>): Promise<void> {
    if (!(await this.db.getBotRecord(clientId, botId))) throw notFound('Bot introuvable.');
    await this.credentials.setCredentials(clientId, botId, 'crm', connector, values);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'crm.set', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { connector } });
  }

  async getCrmMasked(clientId: string, botId: string, connector: string): Promise<{ configured: boolean; fields?: Record<string, string> }> {
    return this.credentials.getMasked(clientId, botId, 'crm', connector);
  }

  async validateCrm(clientId: string, botId: string, connector: string): Promise<{ ok: boolean; error?: string }> {
    const rec = (await getCredentialRecord(clientId, botId, 'crm', connector)) ?? (await getCredentialRecord(clientId, null, 'crm', connector));
    if (!rec) throw conflict('Aucun identifiant CRM configuré.');
    const credentials = decryptJson(rec.secret_encrypted, rec.key_version) as Record<string, string>;
    const FIELDMAPPER = new Set(['hubspot', 'pipedrive', 'salesforce', 'zoho']);
    let mapping: FieldMapping | undefined;
    if (FIELDMAPPER.has(connector)) {
      const m = await getMapping(clientId, botId, connector);
      if (!m) throw conflict('Mapping requis pour ce connecteur.');
      mapping = m;
    }
    try {
      const conn = createConnector({ type: connector, credentials: { ...credentials, client_id: clientId }, mapping });
      if (!conn.validate) return { ok: false, error: 'Validation non supportée pour ce connecteur.' };
      return await conn.validate();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ─── LLM ────────────────────────────────────────────────────────────────────

  async setLlm(clientId: string, botId: string, actorUserId: number | null, input: SetLlmInput): Promise<void> {
    const rec = await this.db.getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');
    if (input.mode === 'byo' && !input.api_key) throw validationError([{ path: 'api_key', message: 'Clé API requise en mode byo.' }]);
    const allNumbers = await this.db.listBotNumbers();
    const numbers = allNumbers.filter((n) => n.client_id === clientId && n.bot_id === botId).map((n) => n.whatsapp_number);
    const updated = { ...rec, llm: { mode: input.mode, ...(input.model ? { model: input.model } : {}) } };
    await upsertBot(updated, numbers);
    if (input.mode === 'byo' && input.api_key) {
      await this.credentials.setCredentials(clientId, botId, 'llm', 'anthropic', { api_key: input.api_key }, 'byo');
    }
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'llm.set', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { mode: input.mode } });
  }

  async getLlm(clientId: string, botId: string): Promise<{ mode: string; model?: string; key_configured: boolean }> {
    const rec = await this.db.getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');
    const key = await this.credentials.getMasked(clientId, botId, 'llm', 'anthropic');
    const mode = rec.llm?.mode ?? 'platform';
    return { mode, ...(rec.llm?.model ? { model: rec.llm.model } : {}), key_configured: key.configured };
  }

  // ─── Mappings ───────────────────────────────────────────────────────────────

  async getMapping(clientId: string, botId: string, connector: string): Promise<FieldMapping | null> {
    return getMapping(clientId, botId, connector);
  }

  async putMapping(clientId: string, botId: string, connector: string, actorUserId: number | null, mapping: FieldMapping): Promise<void> {
    if (!(await this.db.getBotRecord(clientId, botId))) throw notFound('Bot introuvable.');
    await upsertMapping(clientId, botId, connector, mapping);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'mapping.set', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { connector } });
  }
}
