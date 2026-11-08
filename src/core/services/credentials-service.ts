import type { Database } from '../database/types.js';
import { z } from 'zod';
import { getProviderDef, maskCredentials } from '../providers.js';
import { encryptJson, decryptJson } from '../credentials/crypto.js';
import { getCredentialRecord, upsertCredentialRecord } from '../credentials/store.js';
import { validationError } from '../../api/errors.js';
import { invalidateTransports } from '../../transport/index.js';

export interface CredentialsServiceDeps { db: Database; }

export class CredentialsService {
  // db conservé pour cohérence d'injection ; le store lit getDatabase() (positionné par les tests).
  constructor(_deps: CredentialsServiceDeps) { void _deps; }

  /**
   * `values` : champs saisis, limités à la liste du fournisseur. `internal` : champs posés par la plateforme
   * (ex. secret de webhook CM.com), hors liste autorisée, jamais saisis ni renvoyés à la lecture.
   * Pour le transport, chaque champ du fournisseur est requis et non vide.
   */
  async setCredentials(
    clientId: string,
    botId: string | null,
    service: string,
    provider: string,
    values: Record<string, string>,
    mode?: string,
    internal?: Record<string, string>,
  ): Promise<void> {
    const def = getProviderDef(service, provider);
    if (!def) throw validationError([{ path: 'provider', message: 'Provider inconnu.' }]);
    const allowed = new Set(def.fields.map((f) => f.name));
    const unknown = Object.keys(values).filter((k) => !allowed.has(k));
    if (unknown.length > 0) throw validationError(unknown.map((k) => ({ path: `values.${k}`, message: 'Champ non reconnu pour ce provider.' })));
    if (service === 'transport') {
      const missing = def.fields.filter((f) => typeof values[f.name] !== 'string' || values[f.name]!.trim() === '');
      if (missing.length > 0) throw validationError(missing.map((f) => ({ path: `values.${f.name}`, message: 'Champ requis.' })));
    }
    if (internal) {
      const clash = Object.keys(internal).filter((k) => allowed.has(k));
      if (clash.length > 0) throw new Error('[Credentials] Un champ interne ne peut pas porter le nom d\'un champ saisissable.');
    }
    const { secret, keyVersion } = encryptJson({ ...values, ...(internal ?? {}) });
    await upsertCredentialRecord({ client_id: clientId, bot_id: botId, service, provider, mode: mode ?? 'byo', secret_encrypted: secret, key_version: keyVersion });
    if (service === 'transport') invalidateTransports(clientId, botId ?? undefined);
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
