import Anthropic from '@anthropic-ai/sdk';
import { resolveLlmCredentials } from '../core/credentials/resolver.js';

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

export async function getClientForTenant(clientId: string, botId: string | null): Promise<Anthropic> {
  const { apiKey } = await resolveLlmCredentials(clientId, botId);
  if (!apiKey) {
    throw new Error(`[LLM] No API key resolved for client ${clientId} (bot=${botId ?? '-'})`);
  }
  const cached = clientCache.get(apiKey);
  if (cached) return cached;
  const created = new Anthropic({ apiKey, timeout: 60000 });
  clientCache.set(apiKey, created);
  return created;
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
  opts: { clientId: string; botId: string | null; model?: string }
): Promise<string> {
  const client = await getClientForTenant(opts.clientId, opts.botId);

  const system = typeof systemPromptParts === 'string'
    ? systemPromptParts
    : systemPromptParts.map(part => ({
        type: 'text' as const,
        text: part.text,
        ...(part.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }));

  const plan = buildModelPlan(opts.model);
  let lastError: unknown;

  for (let i = 0; i < plan.length; i++) {
    const { model, plan: planId, label } = plan[i]!;
    console.log(`[LLM] Model=${model} (plan ${planId} / ${label})`);

    try {
      const response = await withRetry(() =>
        client.messages.create({
          model,
          max_tokens: 2048,
          system,
          messages,
        })
      );

      if (response.usage && 'cache_read_input_tokens' in response.usage) {
        const usage = response.usage as unknown as Record<string, number>;
        console.log(`[LLM] Cache: read=${usage.cache_read_input_tokens || 0}, creation=${usage.cache_creation_input_tokens || 0}, input=${usage.input_tokens}`);
      }

      if (i > 0) {
        console.log(`[LLM] Fallback reussi sur plan ${planId} (${label})`);
      }

      const block = response.content[0];
      if (block?.type === 'text') return block.text;
      return '[Reponse non-texte]';
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      const hasNext = i < plan.length - 1;
      // Cascade RESILIENTE : sur un plan non-terminal, on bascule TOUJOURS vers
      // le plan suivant, peu importe le type d'erreur (429, 529, 404, 500, timeout,
      // auth, etc.). Mieux vaut un fallback qui repond que l'echec total.
      // Le dernier plan (terminal) re-throw : le user verra le message d'erreur.
      if (hasNext) {
        const next = plan[i + 1]!;
        const errMsg = (err as { message?: string }).message || 'unknown';
        console.warn(`[LLM] Plan ${planId} (${label}) echoue (${status || 'no-status'}: ${errMsg.slice(0, 120)}), bascule vers plan ${next.plan} (${next.label})`);
        continue;
      }
      // Dernier plan : erreur finale, on laisse remonter
      throw err;
    }
  }

  throw lastError || new Error('[LLM] Cascade epuise sans succes');
}

// Export pour tests / debug
export { MODEL_CASCADE, DEFAULT_MODEL };
