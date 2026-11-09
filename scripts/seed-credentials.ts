/**
 * Migration one-shot : lit les variables d'environnement de la plateforme (ANTHROPIC_API_KEY, HUBSPOT_TOKEN) et
 * écrit des identifiants chiffrés pour l'organisation `default`. Aucun identifiant WhatsApp : ils appartiennent
 * aux comptes WhatsApp d'organisation, raccordés depuis le back-office (lot 2b-2) ; META_* n'est pas lu.
 *
 * Ce script sème des identifiants DE LA PLATEFORME comme identifiants de l'organisation `default` : tous les
 * agents IA de `default` en héritent par le repli organisation. À n'utiliser que pour l'organisation de
 * démonstration de la plateforme, jamais pour une organisation cliente. Il n'y a aucun repli sur .env pour les
 * identifiants de CRM : sans enregistrement, un agent IA n'en a pas. La clé LLM, elle, retombe
 * sur la clé de la plateforme en mode platform. Le script écrit aussi le pool de clés de la plateforme
 * (buildPlatformKeyRecords).
 * Exécuter : npx tsx scripts/seed-credentials.ts
 */

import 'dotenv/config';
import { encryptJson } from '../src/core/credentials/crypto.js';
import { initDatabase, getDatabase } from '../src/core/database/index.js';
import type { CredentialRecord, PlatformKeyInput } from '../src/core/database/types.js';

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

  if (env['HUBSPOT_TOKEN']) {
    recs.push(makeRecord('crm', 'hubspot', 'byo', { access_token: env['HUBSPOT_TOKEN'] }));
  }

  return recs;
}

export function buildPlatformKeyRecords(env: Env): PlatformKeyInput[] {
  const multi = (env['ANTHROPIC_API_KEYS'] || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const keys = multi.length > 0
    ? multi
    : (env['ANTHROPIC_API_KEY'] || '').trim()
      ? [(env['ANTHROPIC_API_KEY'] || '').trim()]
      : [];

  return keys.map((api_key, i) => {
    const { secret, keyVersion } = encryptJson({ api_key });
    return { label: `pool-${i + 1}`, secret_encrypted: secret, key_version: keyVersion, active: true };
  });
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

  const poolKeys = buildPlatformKeyRecords(process.env);
  for (const rec of poolKeys) {
    await db.upsertPlatformKey(rec);
    console.log(`[Seed] platform key ${rec.label} -> pool`);
  }
  console.log(`[Seed] ${poolKeys.length} clé(s) plateforme dans le pool.`);
  await db.close();
}

// Exécution directe uniquement (pas à l'import en test)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[Seed] échec:', err);
    process.exit(1);
  });
}
