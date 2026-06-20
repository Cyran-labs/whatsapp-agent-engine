/**
 * Migration one-shot : lit les globals .env et écrit des credentials chiffrés
 * pour le client `default`. Non destructif : tant qu'aucun enregistrement n'existe,
 * le resolver retombe sur .env. Exécuter : npx tsx scripts/seed-credentials.ts
 */

import 'dotenv/config';
import { encryptJson } from '../src/core/credentials/crypto.js';
import { initDatabase, getDatabase } from '../src/core/database/index.js';
import type { CredentialRecord } from '../src/core/database/types.js';

type Env = Record<string, string | undefined>;

function makeRecord(
  service: string,
  provider: string,
  mode: string,
  value: Record<string, string>,
): CredentialRecord {
  const { secret, keyVersion } = encryptJson(value);
  return {
    client_id: 'default',
    bot_id: null,
    service,
    provider,
    mode,
    secret_encrypted: secret,
    key_version: keyVersion,
  };
}

export function buildSeedRecords(env: Env): CredentialRecord[] {
  const recs: CredentialRecord[] = [];

  if (env['ANTHROPIC_API_KEY']) {
    recs.push(makeRecord('llm', 'anthropic', 'byo', { api_key: env['ANTHROPIC_API_KEY'] }));
  }

  if (env['META_PHONE_NUMBER_ID'] && env['META_ACCESS_TOKEN']) {
    recs.push(makeRecord('transport', 'meta-cloud', 'byo', {
      phone_number_id: env['META_PHONE_NUMBER_ID'],
      access_token: env['META_ACCESS_TOKEN'],
      app_secret: env['META_APP_SECRET'] ?? '',
      verify_token: env['META_VERIFY_TOKEN'] ?? '',
    }));
  }

  if (env['HUBSPOT_TOKEN']) {
    recs.push(makeRecord('crm', 'hubspot', 'byo', { access_token: env['HUBSPOT_TOKEN'] }));
  }

  return recs;
}

async function main(): Promise<void> {
  await initDatabase();
  const db = getDatabase();
  const recs = buildSeedRecords(process.env);
  for (const rec of recs) {
    await db.upsertCredential(rec);
    console.log(`[Seed] ${rec.service}/${rec.provider} (mode=${rec.mode}) -> client default`);
  }
  console.log(`[Seed] ${recs.length} credential(s) écrit(s).`);
  await db.close();
}

// Exécution directe uniquement (pas à l'import en test)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[Seed] échec:', err);
    process.exit(1);
  });
}
