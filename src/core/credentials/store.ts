/**
 * Façade typée d'accès DB pour les credentials.
 * Ne fait aucune crypto : renvoie/écrit des enregistrements chiffrés.
 */

import { getDatabase } from '../database/index.js';
import type { CredentialRecord } from '../database/types.js';

export type { CredentialRecord };

export function getCredentialRecord(
  clientId: string,
  botId: string | null,
  service: string,
  provider: string,
): Promise<CredentialRecord | undefined> {
  return getDatabase().getCredential(clientId, botId, service, provider);
}

export function upsertCredentialRecord(rec: CredentialRecord): Promise<void> {
  return getDatabase().upsertCredential(rec);
}

export function listCredentialRecords(clientId: string): Promise<CredentialRecord[]> {
  return getDatabase().listCredentials(clientId);
}
