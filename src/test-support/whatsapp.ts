/**
 * Éléments génériques des tests de webhook WhatsApp : enregistreur de `fetch`, constructeurs de
 * corps Meta et CM.com, lecture des envois sortants. Partagés par les tests de src/webhooks et la
 * suite d'isolation (src/__tests__/isolation) ; aucun identifiant d'organisation ici.
 */
import { createHmac } from 'crypto';
import { vi } from 'vitest';
import type { Database, BotRecord } from '../core/database/types.js';
import { CM_SEND_URL } from '../transport/cm-com.js';

export const CONTACT = '33600000001';

export function botRecord(clientId: string, botId: string, transport: string, overrides: Partial<BotRecord> = {}): BotRecord {
  return {
    client_id: clientId, bot_id: botId, name: botId, transport, status: 'active',
    default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'Tu es un agent IA.' }, lead_fields: 'prenom',
    welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null, personality: null, entity_id: null,
    ...overrides,
  };
}

export interface FetchCall { url: string; headers: Record<string, string>; body: Record<string, unknown> }

/**
 * Remplace `fetch` par un enregistreur qui répond 200 ; à restaurer avec `vi.unstubAllGlobals()`.
 * Les appels sont accumulés dans `calls`.
 */
export function stubFetch(): { calls: FetchCall[]; fetchMock: ReturnType<typeof vi.fn> } {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ url: String(input), headers: { ...(init?.headers ?? {}) }, body });
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

/** Réponses texte envoyées par l'API Meta (hors accusés de lecture et indicateurs de saisie). */
export function metaTexts(calls: FetchCall[]): Array<{ phoneNumberId: string; authorization: string; to: string; text: string }> {
  return calls.flatMap((c) => {
    const match = /graph\.facebook\.com\/[^/]+\/([^/]+)\/messages$/.exec(c.url);
    if (!match || c.body['type'] !== 'text') return [];
    const text = (c.body['text'] as { body?: string } | undefined)?.body ?? '';
    return [{ phoneNumberId: match[1] ?? '', authorization: c.headers['Authorization'] ?? '', to: String(c.body['to']), text }];
  });
}

/** Réponses envoyées par l'API CM.com. */
export function cmTexts(calls: FetchCall[]): Array<{ productToken: string; from: string; text: string }> {
  return calls.flatMap((c) => {
    if (c.url !== CM_SEND_URL) return [];
    const msg = ((c.body['messages'] as { msg?: Array<Record<string, unknown>> } | undefined)?.msg ?? [])[0] ?? {};
    const conversation = ((msg['richContent'] as { conversation?: Array<{ text?: string }> } | undefined)?.conversation ?? []);
    return [{ productToken: c.headers['X-CM-PRODUCTTOKEN'] ?? '', from: String(msg['from']), text: conversation[0]?.text ?? '' }];
  });
}

export interface MetaMessageSpec {
  displayPhone: string;
  phoneNumberId: string;
  id: string;
  from?: string;
  text?: string;
  type?: string;
  /** Secondes depuis l'époque Unix ; maintenant par défaut. */
  timestamp?: number;
}

function metaMessage(spec: MetaMessageSpec): Record<string, unknown> {
  const type = spec.type ?? 'text';
  const base: Record<string, unknown> = {
    from: spec.from ?? CONTACT,
    id: spec.id,
    timestamp: String(spec.timestamp ?? Math.floor(Date.now() / 1000)),
    type,
  };
  if (type === 'text') base['text'] = { body: spec.text ?? 'Bonjour' };
  if (type === 'audio') base['audio'] = { id: 'media-1', mime_type: 'audio/ogg' };
  if (type === 'reaction') base['reaction'] = { message_id: 'x', emoji: 'ok' };
  return base;
}

/** Corps Meta : une entrée par message, chacune avec ses métadonnées de numéro. */
export function metaBody(specs: MetaMessageSpec[]): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: specs.map((spec, i) => ({
      id: `waba-${i}`,
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: spec.displayPhone.replace('+', ''), phone_number_id: spec.phoneNumberId },
          contacts: [{ wa_id: spec.from ?? CONTACT, profile: { name: 'Camille' } }],
          messages: [metaMessage(spec)],
        },
      }],
    })),
  };
}

/** Signature `x-hub-signature-256` d'un corps brut avec un secret d'application. */
export function signBody(raw: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(Buffer.from(raw, 'utf8')).digest('hex');
}

export function cmBody(spec: { to: string; id: string; text?: string; from?: string; timeUtc?: string }): Record<string, unknown> {
  return {
    reference: spec.id,
    messageContext: spec.id,
    from: { number: spec.from ?? `00${CONTACT}`, name: 'Camille' },
    to: { number: spec.to },
    message: { text: spec.text ?? 'Bonjour' },
    ...(spec.timeUtc !== undefined ? { timeUtc: spec.timeUtc } : {}),
  };
}

export async function unservedCount(db: Database, clientId: string, botId: string): Promise<number> {
  return (await db.getBotRuntimeState(clientId, botId))?.unserved_count ?? 0;
}
