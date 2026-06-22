/**
 * Résolution des credentials par tenant.
 *
 * Compose store + crypto, porte la logique byo/platform et le fallback.
 * Seul module appelé par le moteur (transport/LLM/CRM) — branchement au plan de suivi.
 *
 * Ordre de résolution : enregistrement bot-scope -> client-scope -> valeurs .env.
 */

import { decryptJson } from './crypto.js';
import * as defaultStore from './store.js';
import type { CredentialRecord } from '../database/types.js';

interface StoreDeps {
  getCredentialRecord(
    clientId: string,
    botId: string | null,
    service: string,
    provider: string,
  ): Promise<CredentialRecord | undefined>;
}

export interface ResolverDeps {
  store?: StoreDeps;
}

/** Cherche bot-scope puis client-scope. */
async function findRecord(
  store: StoreDeps,
  clientId: string,
  botId: string | null,
  service: string,
  provider: string,
): Promise<CredentialRecord | undefined> {
  if (botId) {
    const botScoped = await store.getCredentialRecord(clientId, botId, service, provider);
    if (botScoped) return botScoped;
  }
  return store.getCredentialRecord(clientId, null, service, provider);
}

function decode(rec: CredentialRecord): Record<string, string> {
  return decryptJson(rec.secret_encrypted, rec.key_version) as Record<string, string>;
}

export function makeResolver(deps: ResolverDeps = {}) {
  const store: StoreDeps = deps.store ?? defaultStore;

  async function resolveLlmCredentials(
    clientId: string,
    botId: string | null,
  ): Promise<{ apiKey: string; mode: 'byo' | 'platform' }> {
    const rec = await findRecord(store, clientId, botId, 'llm', 'anthropic');
    if (rec && rec.mode === 'byo') {
      const obj = decode(rec);
      if (obj.api_key) return { apiKey: obj.api_key, mode: 'byo' };
      // Record byo mal formé (api_key absent) : on ne bascule pas en silence sur la
      // clé plateforme — un client byo croirait utiliser sa clé/son quota propre.
      console.warn(`[CredentialResolver] byo record without api_key for client ${clientId} (bot=${botId ?? '-'}), falling back to platform key`);
    }
    // mode platform OU pas d'enregistrement -> clé plateforme.
    return { apiKey: process.env['ANTHROPIC_API_KEY'] || '', mode: 'platform' };
  }

  async function resolveTransportCredentials(
    clientId: string,
    botId: string | null,
    provider: string,
  ): Promise<Record<string, string>> {
    const rec = await findRecord(store, clientId, botId, 'transport', provider);
    if (rec) return decode(rec);
    return {}; // fallback .env géré par l'appelant (config global) au plan de suivi
  }

  async function resolveCrmCredentials(
    clientId: string,
    botId: string | null,
    provider: string,
  ): Promise<Record<string, string>> {
    const rec = await findRecord(store, clientId, botId, 'crm', provider);
    if (rec) return decode(rec);
    return {};
  }

  return { resolveLlmCredentials, resolveTransportCredentials, resolveCrmCredentials };
}

const defaultResolver = makeResolver();
export const resolveLlmCredentials = defaultResolver.resolveLlmCredentials;
export const resolveTransportCredentials = defaultResolver.resolveTransportCredentials;
export const resolveCrmCredentials = defaultResolver.resolveCrmCredentials;
