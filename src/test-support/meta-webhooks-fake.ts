/**
 * Faux client d'inscription des webhooks Meta (lot R1), partagé par les tests du service des comptes, des routes et la
 * suite d'isolation. Il garde l'état d'un Meta simulé (override par WABA, webhook par app) et le journal de chaque
 * appel, pour vérifier l'ordre des appels, les adresses inscrites et qu'aucune écriture n'a eu lieu.
 */
import { vi } from 'vitest';
import type { MetaWebhookClient } from '../whatsapp/meta-webhooks.js';

export type MetaWebhookOp = 'readWabaOverride' | 'setWabaOverride' | 'clearWabaOverride' | 'readAppWebhook' | 'setAppWebhook';

export interface MetaWebhookCall {
  op: MetaWebhookOp;
  /** WABA (appels de la WABA) ou app (appels de l'app). */
  target: string;
  /** Adresse inscrite (écritures `set...` seulement). */
  url?: string;
  verify_token?: string;
  /** Jeton du compte (appels de la WABA) ou secret de l'app (appels de l'app) : identifiants utilisés pour l'appel. */
  credential: string;
}

const WRITES: ReadonlySet<MetaWebhookOp> = new Set(['setWabaOverride', 'clearWabaOverride', 'setAppWebhook']);

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? ReturnType<typeof vi.fn<(...args: A) => R>> : T[K] };

export type FakeMetaWebhooks = Mocked<MetaWebhookClient> & {
  /**
   * Journal de chaque appel, dans l'ordre, lu dans les appels des fonctions simulées : il compte aussi les appels dont
   * la réponse a été remplacée par un test (`mockResolvedValueOnce`).
   */
  readonly calls: MetaWebhookCall[];
  /** Écritures chez Meta seulement (inscription, retrait, webhook de l'app). */
  writes(): MetaWebhookCall[];
  /** Oublie les appels passés (l'état du Meta simulé et les réponses restent). */
  clearCalls(): void;
  /** Override inscrit par WABA (absent : aucun). */
  overrides: Map<string, string>;
  /** Webhook de l'app par app Meta (absent : aucun). */
  appWebhooks: Map<string, string>;
};

/** Meta simulé : les écritures réussissent et la relecture rend ce qui a été écrit. */
export function fakeMetaWebhooks(): FakeMetaWebhooks {
  const overrides = new Map<string, string>();
  const appWebhooks = new Map<string, string>();
  const subscribed = new Set<string>();
  const fns = {
    readWabaOverride: vi.fn<MetaWebhookClient['readWabaOverride']>(async (c) => (
      { ok: true, subscribed: subscribed.has(c.waba_id), override: overrides.get(c.waba_id) ?? null }
    )),
    setWabaOverride: vi.fn<MetaWebhookClient['setWabaOverride']>(async (c, t) => {
      subscribed.add(c.waba_id);
      overrides.set(c.waba_id, t.callbackUrl);
      return { ok: true };
    }),
    clearWabaOverride: vi.fn<MetaWebhookClient['clearWabaOverride']>(async (c) => {
      overrides.delete(c.waba_id);
      return { ok: true };
    }),
    readAppWebhook: vi.fn<MetaWebhookClient['readAppWebhook']>(async (app) => ({ ok: true, callbackUrl: appWebhooks.get(app.appId) ?? null })),
    setAppWebhook: vi.fn<MetaWebhookClient['setAppWebhook']>(async (app, t) => {
      appWebhooks.set(app.appId, t.callbackUrl);
      return { ok: true };
    }),
  };
  const collect = (): MetaWebhookCall[] => {
    const entries: Array<[number, MetaWebhookCall]> = [];
    fns.readWabaOverride.mock.calls.forEach(([c], i) => entries.push([fns.readWabaOverride.mock.invocationCallOrder[i]!,
      { op: 'readWabaOverride', target: c.waba_id, credential: c.access_token }]));
    fns.setWabaOverride.mock.calls.forEach(([c, t], i) => entries.push([fns.setWabaOverride.mock.invocationCallOrder[i]!,
      { op: 'setWabaOverride', target: c.waba_id, url: t.callbackUrl, verify_token: t.verifyToken, credential: c.access_token }]));
    fns.clearWabaOverride.mock.calls.forEach(([c], i) => entries.push([fns.clearWabaOverride.mock.invocationCallOrder[i]!,
      { op: 'clearWabaOverride', target: c.waba_id, credential: c.access_token }]));
    fns.readAppWebhook.mock.calls.forEach(([app], i) => entries.push([fns.readAppWebhook.mock.invocationCallOrder[i]!,
      { op: 'readAppWebhook', target: app.appId, credential: app.appSecret }]));
    fns.setAppWebhook.mock.calls.forEach(([app, t], i) => entries.push([fns.setAppWebhook.mock.invocationCallOrder[i]!,
      { op: 'setAppWebhook', target: app.appId, url: t.callbackUrl, verify_token: t.verifyToken, credential: app.appSecret }]));
    return entries.sort((a, b) => a[0] - b[0]).map(([, call]) => call);
  };
  return {
    ...fns,
    overrides,
    appWebhooks,
    get calls() { return collect(); },
    writes: () => collect().filter((c) => WRITES.has(c.op)),
    clearCalls: () => { for (const fn of Object.values(fns)) fn.mockClear(); },
  };
}

/** Clé d'URL d'une adresse `.../webhook/meta/<clé>` inscrite chez Meta. */
export function keyOfMetaUrl(url: string): string {
  const marker = '/webhook/meta/';
  const at = url.indexOf(marker);
  if (at < 0) throw new Error('[Test] adresse de webhook Meta attendue');
  return url.slice(at + marker.length);
}
