import type { Database } from '../database/types.js';
import { z } from 'zod';
import { getProviderDef, maskCredentials } from '../providers.js';
import { encryptJson, decryptJson } from '../credentials/crypto.js';
import { getCredentialRecord, upsertCredentialRecord } from '../credentials/store.js';
import { validationError } from '../../api/errors.js';

export interface CredentialsServiceDeps { db: Database; }

export class CredentialsService {
  // db conservé pour cohérence d'injection ; le store lit getDatabase() (positionné par les tests).
  constructor(_deps: CredentialsServiceDeps) { void _deps; }

  async setCredentials(clientId: string, botId: string | null, service: string, provider: string, values: Record<string, string>, mode?: string): Promise<void> {
    const def = getProviderDef(service, provider);
    if (!def) throw validationError([{ path: 'provider', message: 'Provider inconnu.' }]);
    const allowed = new Set(def.fields.map((f) => f.name));
    const unknown = Object.keys(values).filter((k) => !allowed.has(k));
    if (unknown.length > 0) throw validationError(unknown.map((k) => ({ path: `values.${k}`, message: 'Champ non reconnu pour ce provider.' })));
    const { secret, keyVersion } = encryptJson(values);
    await upsertCredentialRecord({ client_id: clientId, bot_id: botId, service, provider, mode: mode ?? 'byo', secret_encrypted: secret, key_version: keyVersion });
  }

  async getMasked(clientId: string, botId: string | null, service: string, provider: string): Promise<{ configured: boolean; fields?: Record<string, string> }> {
    const def = getProviderDef(service, provider);
    if (!def) throw validationError([{ path: 'provider', message: 'Provider inconnu.' }]);
    const rec = await getCredentialRecord(clientId, botId, service, provider);
    if (!rec) return { configured: false };
    const raw = decryptJson(rec.secret_encrypted, rec.key_version);
    const values = z.record(z.string()).parse(raw);
    return { configured: true, fields: maskCredentials(def, values) };
  }
}
