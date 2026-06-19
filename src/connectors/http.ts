/**
 * Helper HTTP partagé pour les connecteurs CRM : fetch avec retry exponentiel,
 * timeout et fail-fast sur les erreurs client 4xx (sauf 429).
 *
 * Les connecteurs HubSpot et Attio embarquent leur propre `request()` (historique) ;
 * les nouveaux connecteurs (Pipedrive, Salesforce, Zoho) passent par ce helper pour
 * éviter la duplication. Une harmonisation de HubSpot/Attio pourra suivre.
 */

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAYS_MS = [1000, 4000, 16000];
const DEFAULT_TIMEOUT_MS = 10000;

/** Erreur HTTP typée : porte le status pour décider du fail-fast côté appelant. */
export class CrmHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly service: string,
  ) {
    super(`${service} ${status}: ${body.slice(0, 200)}`);
    this.name = 'CrmHttpError';
  }
}

export interface RequestOptions {
  service: string;                 // Nom pour les logs, ex: 'Pipedrive'
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelaysMs?: number[];
}

/**
 * Effectue une requête JSON avec retry exponentiel.
 * - 2xx : retourne le JSON parsé (ou undefined si corps vide / 204).
 * - 4xx (hors 429) : throw CrmHttpError immédiatement (pas de retry).
 * - 429 / 5xx / erreur réseau : retry jusqu'à maxRetries, puis throw.
 */
export async function requestJson<T>(method: string, url: string, opts: RequestOptions): Promise<T> {
  const service = opts.service;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, delays[attempt - 1] ?? delays[delays.length - 1]));
    }

    try {
      const res = await fetch(url, {
        method,
        headers: opts.headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      const text = await res.text();

      // Fail-fast sur les erreurs client (sauf 429 rate-limit qui est retryable).
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        console.error(`[${service}] ${method} ${redact(url)} client error ${res.status}: ${text.slice(0, 300)}`);
        throw new CrmHttpError(res.status, text, service);
      }

      lastError = new CrmHttpError(res.status, text, service);
      console.warn(`[${service}] ${method} ${redact(url)} retryable error ${res.status} (attempt ${attempt + 1}/${maxRetries})`);
    } catch (err) {
      if (err instanceof CrmHttpError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw err; // fail-fast déjà décidé
      }
      lastError = err as Error;
      console.warn(`[${service}] ${method} ${redact(url)} attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  console.error(`[${service}] ${method} ${redact(url)} FAILED after ${maxRetries} attempts`);
  throw lastError ?? new Error(`${service} request failed`);
}

/** Masque un éventuel api_token en query string dans les logs. */
function redact(url: string): string {
  return url.replace(/([?&]api_token=)[^&]+/i, '$1***');
}
