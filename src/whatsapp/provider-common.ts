// Éléments communs aux clients de vérification des fournisseurs (Meta, CM.com), spec §7.
// Aucun secret ne sort de ces modules : les textes renvoyés sont masqués et bornés.

import type { ProviderNumber } from '../core/database/whatsapp-types.js';

export type VerificationCheckKey =
  | 'token' | 'waba_access' | 'app_secret' | 'subscription' | 'token_expiry' | 'numbers' | 'cm_account' | 'cm_channels'
  // Application Meta du jeton, contrôlée par le service des comptes (choix 3) ; jamais produite par les clients.
  | 'app';

export interface VerificationCheck {
  key: VerificationCheckKey;
  status: 'ok' | 'failed' | 'pending' | 'created';
  detail?: string;
}

export type ProviderErrorReason = 'token_invalid' | 'other';

export interface ProviderSkipped {
  sandbox: number;
  invalid_number: number;
}

export type ProviderVerification =
  | {
    ok: true;
    checks: VerificationCheck[];
    account_name: string;
    waba_id: string | null;
    meta_app_id: string | null;
    token_expiry: string | null;
    numbers: ProviderNumber[];
    skipped: ProviderSkipped;
  }
  | { ok: false; checks: VerificationCheck[]; error_reason: ProviderErrorReason; message: string };

export interface ProviderListing {
  numbers: ProviderNumber[];
  skipped: ProviderSkipped;
  error?: { reason: ProviderErrorReason; message: string };
}

export interface ProviderClientOptions {
  fetchImpl?: typeof fetch;
}

export const PROVIDER_TIMEOUT_MS = 10_000;
export const MAX_TEXT_LENGTH = 200;
const MASK = '[masqué]';

/** Remplace chaque secret (et sa forme encodée pour une URL) par `[masqué]`, puis borne à 200 caractères. */
export function sanitizeProviderText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    out = out.split(secret).join(MASK);
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) out = out.split(encoded).join(MASK);
  }
  return out.slice(0, MAX_TEXT_LENGTH);
}

export type HttpOutcome =
  | { kind: 'response'; status: number; body: unknown }
  | { kind: 'timeout' }
  | { kind: 'unreachable' };

/**
 * Un appel JSON avec délai de 10 s. Les redirections sont refusées : un en-tête d'authentification
 * ne doit jamais suivre le fournisseur vers un autre hôte. Aucune cause d'erreur n'est conservée
 * (elle pourrait contenir l'URL ou un en-tête).
 */
export async function httpJson(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<HttpOutcome> {
  try {
    const res = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
    const text = await res.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { kind: 'response', status: res.status, body };
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return { kind: 'timeout' };
    return { kind: 'unreachable' };
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
