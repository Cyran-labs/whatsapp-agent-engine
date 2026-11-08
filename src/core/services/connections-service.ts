import type { Database, BotRecord } from '../database/types.js';
import type { CredentialsService } from './credentials-service.js';
import { recordAudit } from '../audit.js';
import { conflict, notFound, validationError } from '../../api/errors.js';
import { getCredentialRecord } from '../credentials/store.js';
import { decryptJson } from '../credentials/crypto.js';
import { buildTransport } from '../../transport/index.js';
import type { TransportId } from '../bot-config.js';
import { randomBytes } from 'crypto';
import { createConnector } from '../../connectors/registry.js';
import { getMapping, upsertMapping, upsertBot } from '../config-store.js';
import type { FieldMapping } from '../../connectors/field-mapper.js';
import type { SetLlmInput } from '@wabagent/contracts';

export interface ConnectionsServiceDeps { db: Database; credentials: CredentialsService; }

export class ConnectionsService {
  private readonly db: Database;
  private readonly credentials: CredentialsService;
  constructor(deps: ConnectionsServiceDeps) { this.db = deps.db; this.credentials = deps.credentials; }

  /** Bot de l'organisation, sinon 404 : un agent d'une autre organisation est indistinguable d'un agent inconnu. */
  private async requireBot(clientId: string, botId: string): Promise<BotRecord> {
    const rec = await this.db.getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');
    return rec;
  }

  private async requireBotTransport(clientId: string, botId: string): Promise<string> {
    return (await this.requireBot(clientId, botId)).transport;
  }

  /** Secret de webhook déjà enregistré pour l'agent IA (CM.com), ou null. Lu au niveau de l'agent IA uniquement. */
  private async storedWebhookSecret(clientId: string, botId: string): Promise<string | null> {
    const rec = await getCredentialRecord(clientId, botId, 'transport', 'cm-com');
    if (!rec) return null;
    const secret = (decryptJson(rec.secret_encrypted, rec.key_version) as Record<string, unknown>)['webhook_secret'];
    return typeof secret === 'string' && secret !== '' ? secret : null;
  }

  async setTransport(clientId: string, botId: string, actorUserId: number | null, values: Record<string, string>): Promise<void> {
    const provider = await this.requireBotTransport(clientId, botId);
    // CM.com n'a pas de signature : l'URL de webhook porte un secret généré par la plateforme, conservé d'une saisie à l'autre.
    const internal = provider === 'cm-com'
      ? { webhook_secret: (await this.storedWebhookSecret(clientId, botId)) ?? randomBytes(24).toString('base64url') }
      : undefined;
    await this.credentials.setCredentials(clientId, botId, 'transport', provider, values, undefined, internal);
    await this.db.setTransportValidation(clientId, botId, null, null); // creds changées -> re-valider
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'transport.set', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { provider } });
  }

  async getTransportMasked(clientId: string, botId: string): Promise<{ configured: boolean; fields?: Record<string, string>; webhook_path?: string; validated_at: string | null; error: string | null }> {
    const provider = await this.requireBotTransport(clientId, botId);
    const masked = await this.credentials.getMasked(clientId, botId, 'transport', provider);
    const rt = await this.db.getBotRuntimeState(clientId, botId);
    let webhookPath: string | undefined;
    if (masked.configured && provider === 'cm-com') {
      const secret = await this.storedWebhookSecret(clientId, botId);
      if (secret) webhookPath = `/webhook/cm-com/${encodeURIComponent(clientId)}/${encodeURIComponent(botId)}/${encodeURIComponent(secret)}`;
    }
    return { ...masked, ...(webhookPath ? { webhook_path: webhookPath } : {}), validated_at: rt?.transport_validated_at ?? null, error: rt?.transport_error ?? null };
  }

  async validateTransport(clientId: string, botId: string, actorUserId: number | null): Promise<{ ok: boolean; error?: string }> {
    const provider = await this.requireBotTransport(clientId, botId);
    const rec = await getCredentialRecord(clientId, botId, 'transport', provider);
    if (!rec) throw conflict('Aucun identifiant transport configuré.');
    const creds = decryptJson(rec.secret_encrypted, rec.key_version) as Record<string, string>;

    let result: { ok: boolean; error?: string };
    try {
      const transport = buildTransport(provider as TransportId, creds);
      if (!transport) result = { ok: false, error: 'Identifiants incomplets : tous les champs sont requis.' };
      else result = transport.validateCredentials ? await transport.validateCredentials() : { ok: true };
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

  // ─── CRM ────────────────────────────────────────────────────────────────────

  async setCrm(clientId: string, botId: string, actorUserId: number | null, connector: string, values: Record<string, string>): Promise<void> {
    if (!(await this.db.getBotRecord(clientId, botId))) throw notFound('Bot introuvable.');
    await this.credentials.setCredentials(clientId, botId, 'crm', connector, values);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'crm.set', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { connector } });
  }

  async getCrmMasked(clientId: string, botId: string, connector: string): Promise<{ configured: boolean; fields?: Record<string, string> }> {
    await this.requireBot(clientId, botId);
    return this.credentials.getMasked(clientId, botId, 'crm', connector);
  }

  async validateCrm(clientId: string, botId: string, connector: string, actorUserId?: number | null): Promise<{ ok: boolean; error?: string }> {
    await this.requireBot(clientId, botId);
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
    let result: { ok: boolean; error?: string };
    try {
      const conn = createConnector({ type: connector, credentials: { ...credentials, client_id: clientId }, mapping });
      if (!conn.validate) {
        result = { ok: false, error: 'Validation non supportée pour ce connecteur.' };
      } else {
        result = await conn.validate();
      }
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    await recordAudit(this.db, { actor_user_id: actorUserId ?? null, action: 'crm.validate', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { connector, ok: result.ok } });
    return result;
  }

  // ─── LLM ────────────────────────────────────────────────────────────────────

  async setLlm(clientId: string, botId: string, actorUserId: number | null, input: SetLlmInput): Promise<void> {
    const rec = await this.db.getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');
    if (input.mode === 'byo' && !input.api_key) throw validationError([{ path: 'api_key', message: 'Clé API requise en mode byo.' }]);
    const updated = { ...rec, llm: { mode: input.mode, ...(input.model ? { model: input.model } : {}) } };
    await upsertBot(updated);
    if (input.mode === 'byo' && input.api_key) {
      await this.credentials.setCredentials(clientId, botId, 'llm', 'anthropic', { api_key: input.api_key }, 'byo');
    }
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'llm.set', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { mode: input.mode } });
  }

  async getLlm(clientId: string, botId: string): Promise<{ mode: string; model?: string; key_configured: boolean }> {
    const rec = await this.db.getBotRecord(clientId, botId);
    if (!rec) throw notFound('Bot introuvable.');
    const mode = rec.llm?.mode ?? 'platform';
    const key = await this.credentials.getMasked(clientId, botId, 'llm', 'anthropic');
    return { mode, ...(rec.llm?.model ? { model: rec.llm.model } : {}), key_configured: mode === 'byo' && key.configured };
  }

  // ─── Mappings ───────────────────────────────────────────────────────────────

  async getMapping(clientId: string, botId: string, connector: string): Promise<FieldMapping | null> {
    await this.requireBot(clientId, botId);
    return getMapping(clientId, botId, connector);
  }

  async putMapping(clientId: string, botId: string, connector: string, actorUserId: number | null, mapping: FieldMapping): Promise<void> {
    if (!(await this.db.getBotRecord(clientId, botId))) throw notFound('Bot introuvable.');
    await upsertMapping(clientId, botId, connector, mapping);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'mapping.set', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { connector } });
  }

  async getClientMapping(clientId: string, connector: string): Promise<FieldMapping | null> {
    return getMapping(clientId, null, connector);
  }

  async putClientMapping(clientId: string, connector: string, actorUserId: number | null, mapping: FieldMapping): Promise<void> {
    await upsertMapping(clientId, null, connector, mapping);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'mapping.client.set', target: `client:${clientId}`, client_id: clientId, metadata: { connector } });
  }
}
