import Anthropic from '@anthropic-ai/sdk';
import { resolveLlmCredentials } from '../core/credentials/resolver.js';
import { recordUsage } from './usage-recorder.js';
import { keyPool } from './key-pool.js';
import { clientFairQueue } from './client-fairness.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SystemPromptPart {
  text: string;
  cache?: boolean;
}

// Cascade de modeles en fallback crescendo pour absorber les 429/529 Anthropic
// (Overloaded / Rate limit). Ordre : qualite decroissante, vitesse croissante.
// Si un modele echoue apres ses retries, on bascule automatiquement sur le suivant.
const MODEL_CASCADE = [
  { model: 'claude-sonnet-4-20250514', plan: 'A', label: 'Sonnet 4' },
  { model: 'claude-sonnet-4-5-20250929', plan: 'B', label: 'Sonnet 4.5' },
  { model: 'claude-haiku-4-5-20251001', plan: 'C', label: 'Haiku 4.5' },
] as const;

const DEFAULT_MODEL = MODEL_CASCADE[0].model;

// Cache des clients Anthropic par apiKey résolue : deux tenants BYO avec la même
// clé partagent un client ; des clés distinctes -> pools de rate limit isolés.
const clientCache = new Map<string, Anthropic>();

/** Cache d'un client Anthropic par apiKey (deux tenants même clé = client partagé). */
export function getClientForApiKey(apiKey: string): Anthropic {
  const cached = clientCache.get(apiKey);
  if (cached) return cached;
  const created = new Anthropic({ apiKey, timeout: 60000 });
  clientCache.set(apiKey, created);
  return created;
}

export async function getClientForTenant(clientId: string, botId: string | null): Promise<Anthropic> {
  const { apiKey } = await resolveLlmCredentials(clientId, botId);
  if (!apiKey) {
    throw new Error(`[LLM] No API key resolved for client ${clientId} (bot=${botId ?? '-'})`);
  }
  return getClientForApiKey(apiKey);
}

export async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  const delays = [500, 1500, 3000];
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if ((status === 429 || status === 529) && attempt < retries) {
        const delay = delays[attempt] ?? 3000;
        console.log(`[LLM] ${status} on attempt ${attempt + 1}, retrying in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('[LLM] Unreachable');
}

// Fabrique la liste de modeles a essayer pour un appel donne.
// - Si modelOverride explicite : un seul modele, pas de cascade (ex: extraction Haiku)
// - Si env LLM_MODEL pinne : un seul modele, pas de cascade
// - Sinon : cascade complete Plan A -> Plan B -> Plan C
function buildModelPlan(modelOverride?: string): Array<{ model: string; plan: string; label: string }> {
  if (modelOverride) {
    return [{ model: modelOverride, plan: 'override', label: modelOverride }];
  }
  const env = process.env['LLM_MODEL'];
  if (env) {
    return [{ model: env, plan: 'env', label: env }];
  }
  return [...MODEL_CASCADE];
}

export async function chat(
  systemPromptParts: SystemPromptPart[] | string,
  messages: ChatMessage[],
  opts: { clientId: string; botId: string | null; model?: string; mode?: 'byo' | 'platform' }
): Promise<string> {
  const resolved = await resolveLlmCredentials(opts.clientId, opts.botId);
  const mode = opts.mode ?? resolved.mode;
  const apiKey = resolved.apiKey;

  const system = typeof systemPromptParts === 'string'
    ? systemPromptParts
    : systemPromptParts.map(part => ({
        type: 'text' as const,
        text: part.text,
        ...(part.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }));

  const plan = buildModelPlan(opts.model);

  const logUsage = (response: { usage?: unknown }) => {
    if (response.usage && typeof response.usage === 'object' && 'cache_read_input_tokens' in response.usage) {
      const usage = response.usage as unknown as Record<string, number>;
      console.log(`[LLM] Cache: read=${usage.cache_read_input_tokens || 0}, creation=${usage.cache_creation_input_tokens || 0}, input=${usage.input_tokens}`);
    }
  };

  const capture = (model: string, response: { usage?: unknown }): void => {
    void recordUsage({
      clientId: opts.clientId, botId: opts.botId, phone: null,
      callType: 'chat', mode, model, usage: response.usage,
    });
  };

  const extractText = (response: { content: Array<{ type: string; text?: string }> }): string => {
    const block = response.content[0];
    if (block?.type === 'text') return block.text ?? '[Reponse non-texte]';
    return '[Reponse non-texte]';
  };

  // --- BYO : chemin historique inchangé (client unique + cascade + withRetry) ---
  if (mode === 'byo') {
    if (!apiKey) {
      throw new Error(`[LLM] No API key resolved for client ${opts.clientId} (bot=${opts.botId ?? '-'})`);
    }
    const client = getClientForApiKey(apiKey);
    let lastError: unknown;
    for (let i = 0; i < plan.length; i++) {
      const { model, plan: planId, label } = plan[i]!;
      console.log(`[LLM] Model=${model} (plan ${planId} / ${label})`);
      try {
        const response = await withRetry(() =>
          client.messages.create({ model, max_tokens: 2048, system, messages })
        );
        logUsage(response);
        capture(model, response);
        if (i > 0) console.log(`[LLM] Fallback reussi sur plan ${planId} (${label})`);
        return extractText(response);
      } catch (err) {
        lastError = err;
        const status = (err as { status?: number }).status;
        const hasNext = i < plan.length - 1;
        if (hasNext) {
          const next = plan[i + 1]!;
          const errMsg = (err as { message?: string }).message || 'unknown';
          console.warn(`[LLM] Plan ${planId} (${label}) echoue (${status || 'no-status'}: ${errMsg.slice(0, 120)}), bascule vers plan ${next.plan} (${next.label})`);
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error('[LLM] Cascade epuise sans succes');
  }

  // --- PLATFORM : file par client -> cascade modèle -> pool de clés ---
  return clientFairQueue.run(opts.clientId, async () => {
    let lastError: unknown;
    await keyPool.ensureLoaded();
    const keyAttempts = Math.max(1, keyPool.size());
    for (let i = 0; i < plan.length; i++) {
      const { model, plan: planId, label } = plan[i]!;
      console.log(`[LLMPool] Model=${model} (plan ${planId} / ${label})`);
      // Épuiser les clés disponibles pour CE modèle avant de descendre d'un cran.
      for (let attempt = 0; attempt < keyAttempts; attempt++) {
        try {
          const response = await keyPool.withPlatformKey((key) =>
            getClientForApiKey(key).messages.create({ model, max_tokens: 2048, system, messages })
          );
          logUsage(response);
          capture(model, response);
          if (i > 0 || attempt > 0) console.log(`[LLMPool] Succès plan ${planId} (${label}) après ${attempt + 1} tentative(s) clé`);
          return extractText(response);
        } catch (err) {
          lastError = err;
          const status = (err as { status?: number }).status;
          // 429/529 : retenter une autre clé pour le même modèle (si tentatives restantes).
          if ((status === 429 || status === 529) && attempt < keyAttempts - 1) {
            console.warn(`[LLMPool] Plan ${planId} (${label}) ${status} sur clé, bascule de clé (tentative ${attempt + 2}/${keyAttempts})`);
            continue;
          }
          // erreur non-429 OU clés épuisées : on sort de la boucle clé -> modèle suivant.
          break;
        }
      }
      const hasNext = i < plan.length - 1;
      if (hasNext) {
        const next = plan[i + 1]!;
        console.warn(`[LLMPool] Plan ${planId} (${label}) épuisé, bascule vers plan ${next.plan} (${next.label})`);
        continue;
      }
      throw lastError || new Error('[LLMPool] Cascade épuisée sans succès');
    }
    throw lastError || new Error('[LLMPool] Cascade épuisée sans succès');
  });
}

// Export pour tests / debug
export { MODEL_CASCADE, DEFAULT_MODEL };
