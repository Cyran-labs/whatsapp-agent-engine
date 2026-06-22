import type { Database } from '../database/types.js';
import type { CredentialsService } from './credentials-service.js';
import { recordAudit } from '../audit.js';
import { conflict, notFound } from '../../api/errors.js';
import { getCredentialRecord } from '../credentials/store.js';
import { decryptJson } from '../credentials/crypto.js';
import { createMetaCloudTransport } from '../../transport/meta-cloud.js';
import { createCmComTransport } from '../../transport/cm-com.js';
import type { Transport } from '../../transport/types.js';

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
}
