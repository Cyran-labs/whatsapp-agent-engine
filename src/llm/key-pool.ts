/**
 * Pool de clés Anthropic plateforme (mode SaaS).
 *
 * Sélectionne la clé active la moins chargée hors cooldown, encaisse les 429/529
 * en mettant la clé en pause (cooldown) puis en relevant l'erreur — le caller
 * (chat) bascule alors sur une autre clé. Si toutes les clés sont en cooldown, on
 * ATTEND plutôt que d'échouer (invariant UX : pas de coupure en contention).
 *
 * État de charge en mémoire (mono-instance). Les deps (chargement, crypto,
 * horloge) sont injectables : interface prête pour un store partagé multi-instance.
 */

import { getDatabase } from '../core/database/index.js';
import { decryptJson } from '../core/credentials/crypto.js';
import { config } from '../core/config.js';
import type { PlatformKeyRecord } from '../core/database/types.js';

export interface KeyPool {
  withPlatformKey<T>(fn: (apiKey: string) => Promise<T>): Promise<T>;
  size(): number;
  reload(): Promise<void>;
}

export interface KeyPoolDeps {
  loadKeys: () => Promise<PlatformKeyRecord[]>;
  decrypt: (secret: string, keyVersion: number) => { api_key: string };
  cooldownMs: () => number;
  now: () => number;
  waitMs: number;
}

interface KeyState {
  id: number;
  apiKey: string;
  inFlight: number;
  cooldownUntil: number;
}

const DEFAULT_DEPS: KeyPoolDeps = {
  loadKeys: () => getDatabase().listActivePlatformKeys(),
  decrypt: (secret, keyVersion) => decryptJson(secret, keyVersion) as { api_key: string },
  cooldownMs: () => config.llm.keyCooldownMs,
  now: () => Date.now(),
  waitMs: 50,
};

export function makeKeyPool(overrides: Partial<KeyPoolDeps> = {}): KeyPool {
  const deps: KeyPoolDeps = { ...DEFAULT_DEPS, ...overrides };
  let states: KeyState[] = [];
  let loaded = false;

  async function reload(): Promise<void> {
    const recs = await deps.loadKeys();
    states = recs
      .map((r) => {
        const obj = deps.decrypt(r.secret_encrypted, r.key_version);
        const apiKey = obj.api_key;
        if (typeof apiKey !== 'string' || apiKey.length === 0) return null;
        return { id: r.id, apiKey, inFlight: 0, cooldownUntil: 0 };
      })
      .filter((s): s is KeyState => s !== null);
    loaded = true;
  }

  function pickAvailable(): KeyState | null {
    const t = deps.now();
    const ready = states.filter((s) => s.cooldownUntil <= t);
    if (ready.length === 0) return null;
    return ready.reduce((best, s) =>
      s.inFlight < best.inFlight || (s.inFlight === best.inFlight && s.id < best.id) ? s : best
    );
  }

  async function withPlatformKey<T>(fn: (apiKey: string) => Promise<T>): Promise<T> {
    if (!loaded) await reload();
    if (states.length === 0) {
      throw new Error('[LLMPool] no platform keys available (configure ANTHROPIC_API_KEYS)');
    }

    // Boucle d'attente : si toutes les clés sont en cooldown, on patiente.
    let chosen = pickAvailable();
    while (!chosen) {
      await new Promise((r) => setTimeout(r, deps.waitMs));
      chosen = pickAvailable();
    }

    chosen.inFlight++;
    try {
      return await fn(chosen.apiKey);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 429 || status === 529) {
        chosen.cooldownUntil = deps.now() + deps.cooldownMs();
        console.warn(`[LLMPool] key id=${chosen.id} en cooldown (${status})`);
      }
      throw err;
    } finally {
      chosen.inFlight--;
    }
  }

  return {
    withPlatformKey,
    size: () => states.length,
    reload,
  };
}

export const keyPool: KeyPool = makeKeyPool();
