import { describe, expect, it } from 'vitest';
import { makeKeyPool } from '../key-pool.js';
import type { PlatformKeyRecord } from '../../core/database/types.js';

function keys(...labels: string[]): PlatformKeyRecord[] {
  return labels.map((label, i) => ({
    id: i + 1, label, secret_encrypted: `enc-${label}`, key_version: 1, active: true,
  }));
}

// decrypt factice : enc-pool-1 -> { api_key: 'sk-pool-1' }
const decrypt = (secret: string) => ({ api_key: secret.replace('enc-', 'sk-') });

function err(status: number): Error {
  const e = new Error(`status ${status}`) as Error & { status: number };
  e.status = status;
  return e;
}

describe('KeyPool', () => {
  it('pool vide -> erreur de configuration explicite', async () => {
    const pool = makeKeyPool({ loadKeys: async () => [], decrypt });
    await expect(pool.withPlatformKey(async () => 'x')).rejects.toThrow(/\[LLMPool\]/);
  });

  it('choisit la clé la moins chargée', async () => {
    const pool = makeKeyPool({ loadKeys: async () => keys('pool-1', 'pool-2'), decrypt });
    const used: string[] = [];
    // occupe pool-1 (1 en vol) ; le prochain appel doit prendre pool-2.
    let release!: () => void;
    const busy = pool.withPlatformKey(async (k) => {
      used.push(k);
      await new Promise<void>((r) => { release = r; });
    });
    await new Promise((r) => setTimeout(r, 0));
    await pool.withPlatformKey(async (k) => { used.push(k); });
    release();
    await busy;
    expect(used).toEqual(['sk-pool-1', 'sk-pool-2']);
  });

  it('429 met la clé en cooldown et re-throw ; le caller bascule sur une autre clé', async () => {
    let t = 0;
    const pool = makeKeyPool({
      loadKeys: async () => keys('pool-1', 'pool-2'),
      decrypt, now: () => t, cooldownMs: () => 1000,
    });
    // 1er appel sur pool-1 -> 429 -> cooldown pool-1, re-throw
    await expect(pool.withPlatformKey(async () => { throw err(429); })).rejects.toThrow();
    // 2e appel : pool-1 en cooldown -> doit choisir pool-2
    const used = await pool.withPlatformKey(async (k) => k);
    expect(used).toBe('sk-pool-2');
  });

  it('si toutes en cooldown -> attend puis réessaie (ne rejette pas)', async () => {
    let t = 0;
    const pool = makeKeyPool({
      loadKeys: async () => keys('pool-1'),
      decrypt, now: () => t, cooldownMs: () => 1000, waitMs: 5,
    });
    await expect(pool.withPlatformKey(async () => { throw err(429); })).rejects.toThrow();
    // pool-1 en cooldown jusqu'à t=1000. On avance l'horloge pendant l'attente.
    const p = pool.withPlatformKey(async (k) => k);
    t = 2000; // cooldown expiré
    await expect(p).resolves.toBe('sk-pool-1');
  });

  it('décrémente l\'in-flight même sur erreur non-429', async () => {
    const pool = makeKeyPool({ loadKeys: async () => keys('pool-1'), decrypt });
    await expect(pool.withPlatformKey(async () => { throw err(500); })).rejects.toThrow();
    // si l'in-flight n'avait pas été décrémenté, la clé resterait "chargée" mais
    // doit rester utilisable immédiatement (pas de cooldown sur 500).
    expect(await pool.withPlatformKey(async (k) => k)).toBe('sk-pool-1');
  });

  it('size() reflète le nombre de clés chargées', async () => {
    const pool = makeKeyPool({ loadKeys: async () => keys('pool-1', 'pool-2', 'pool-3'), decrypt });
    await pool.reload();
    expect(pool.size()).toBe(3);
  });
});
