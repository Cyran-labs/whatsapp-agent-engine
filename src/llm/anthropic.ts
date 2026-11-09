import Anthropic from '@anthropic-ai/sdk';
import { resolveLlmCredentials } from '../core/credentials/resolver.js';
import { recordUsage } from './usage-recorder.js';
import { keyPool } from './key-pool.js';
import { clientFairQueue } from './client-fairness.js';
import { CHAT_EFFORT, CHAT_MAX_TOKENS, CHAT_MODEL_CASCADE, readReply, type ModelPlanStep, type ReplyMessage } from './models.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SystemPromptPart {
  text: string;
  cache?: boolean;
}

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
// - Si modelOverride explicite (modèle imposé à l'agent IA) : un seul modele, pas de cascade
// - Si env LLM_MODEL pinne : un seul modele, pas de cascade
// - Sinon : cascade complete (CHAT_MODEL_CASCADE)
function buildModelPlan(modelOverride?: string): ModelPlanStep[] {
  if (modelOverride) {
    return [{ model: modelOverride, plan: 'override', label: modelOverride }];
  }
  const env = process.env['LLM_MODEL'];
  if (env) {
    return [{ model: env, plan: 'env', label: env }];
  }
  return [...CHAT_MODEL_CASCADE];
}

/** Le modèle a refusé (sécurité) ou n'a rendu aucun texte : on passe au modèle suivant, sans changer de clé. */
class UnusableReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnusableReplyError';
  }
}

/** Cause d'un échec, pour le journal : code HTTP et début du message, jamais de clé ni de contenu. */
function describeFailure(err: unknown): string {
  const status = (err as { status?: number }).status;
  const message = ((err as { message?: string }).message || 'inconnue').slice(0, 120);
  return status ? `${status} ${message}` : message;
}

export interface ChatOptions {
  clientId: string;
  botId: string | null;
  /** Modèle imposé à l'agent IA : lui seul, sans cascade. */
  model?: string;
  mode?: 'byo' | 'platform';
}

export interface ChatResult {
  text: string;
  /** Modèle qui a réellement répondu (après une éventuelle bascule dans la cascade). */
  model: string;
}

/** Réponse au contact : le texte seul. */
export async function chat(
  systemPromptParts: SystemPromptPart[] | string,
  messages: ChatMessage[],
  opts: ChatOptions
): Promise<string> {
  return (await chatWithModel(systemPromptParts, messages, opts)).text;
}

/** Réponse au contact avec le modèle qui l'a produite. */
export async function chatWithModel(
  systemPromptParts: SystemPromptPart[] | string,
  messages: ChatMessage[],
  opts: ChatOptions
): Promise<ChatResult> {
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

  // Texte de la réponse ; un refus ou une réponse sans texte n'est jamais envoyé au contact.
  const toText = (response: ReplyMessage, label: string): string => {
    const reply = readReply(response);
    if (reply.kind === 'refusal') {
      throw new UnusableReplyError(`refus de sécurité (${label}, catégorie ${reply.category ?? 'non précisée'})`);
    }
    if (reply.kind === 'empty') throw new UnusableReplyError(`réponse sans texte (${label})`);
    if (reply.truncated) console.warn(`[LLM] Réponse tronquée par la limite de jetons (${label})`);
    return reply.text;
  };

  const request = (client: Anthropic, model: string) =>
    client.messages.create({
      model, max_tokens: CHAT_MAX_TOKENS, system, messages, output_config: { effort: CHAT_EFFORT },
    });

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
        const response = await withRetry(() => request(client, model));
        logUsage(response);
        capture(model, response);
        const text = toText(response, label);
        if (i > 0) console.log(`[LLM] Fallback reussi sur plan ${planId} (${label})`);
        return { text, model };
      } catch (err) {
        lastError = err;
        const hasNext = i < plan.length - 1;
        if (hasNext) {
          const next = plan[i + 1]!;
          console.warn(`[LLM] Plan ${planId} (${label}) echoue (${describeFailure(err)}), bascule vers plan ${next.plan} (${next.label})`);
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
          const response = await keyPool.withPlatformKey((key) => request(getClientForApiKey(key), model));
          logUsage(response);
          capture(model, response);
          const text = toText(response, label);
          if (i > 0 || attempt > 0) console.log(`[LLMPool] Succès plan ${planId} (${label}) après ${attempt + 1} tentative(s) clé`);
          return { text, model };
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
        console.warn(`[LLMPool] Plan ${planId} (${label}) échoué (${describeFailure(lastError)}), bascule vers plan ${next.plan} (${next.label})`);
        continue;
      }
      throw lastError || new Error('[LLMPool] Cascade épuisée sans succès');
    }
    throw lastError || new Error('[LLMPool] Cascade épuisée sans succès');
  });
}

