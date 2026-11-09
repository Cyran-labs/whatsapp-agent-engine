/**
 * LLM simulé de la suite d'isolation. Module léger, sans dépendance du moteur : la fabrique de
 * `vi.mock` l'importe pendant le chargement de src/llm/anthropic.js, il ne doit donc rien importer
 * qui dépende lui-même de ce module.
 *
 * Usage dans le fichier de test :
 *   vi.mock('../../llm/anthropic.js', async () => (await import('./llm-mock.js')).llmMockModule());
 */

export interface LlmCall {
  /** `chat` : réponse au contact ; `extraction` : extraction de lead. */
  kind: 'chat' | 'extraction';
  clientId: string;
  botId: string | null;
  /** Tout le prompt système, concaténé. */
  system: string;
  messages: Array<{ role: string; content: string }>;
  /** Toute la matière de l'appel (système et messages), pour chercher une donnée. */
  everything: string;
}

/** Tous les appels du LLM depuis la dernière remise à zéro. */
export const llmCalls: LlmCall[] = [];

/** Réponse de l'extraction de lead (JSON), réglable par test. */
export const llmBehavior: { extraction: (call: LlmCall) => string } = {
  extraction: () => '{}',
};

export function resetLlmMock(): void {
  llmCalls.length = 0;
  llmBehavior.extraction = () => '{}';
}

function record(call: Omit<LlmCall, 'everything'>): LlmCall {
  const full: LlmCall = { ...call, everything: [call.system, ...call.messages.map((m) => `${m.role}: ${m.content}`)].join('\n') };
  llmCalls.push(full);
  return full;
}

interface SystemPart { text: string }
interface ChatMessageLike { role: string; content: string }

export function llmMockModule(): Record<string, unknown> {
  const chat = async (
    systemParts: SystemPart[] | string,
    messages: ChatMessageLike[],
    opts: { clientId: string; botId: string | null },
  ): Promise<string> => {
    const system = typeof systemParts === 'string' ? systemParts : systemParts.map((p) => p.text).join('\n');
    record({ kind: 'chat', clientId: opts.clientId, botId: opts.botId, system, messages: messages.map((m) => ({ role: m.role, content: m.content })) });
    const last = messages[messages.length - 1]?.content ?? '';
    return JSON.stringify({ type: 'text', text: `Réponse de ${opts.clientId}/${opts.botId ?? ''} à : ${last}` });
  };
  return {
    chat,
    // Même enregistrement que `chat` : le test d'un agent IA (simulation) passe par cette fonction.
    chatWithModel: async (
      systemParts: SystemPart[] | string,
      messages: ChatMessageLike[],
      opts: { clientId: string; botId: string | null },
    ): Promise<{ text: string; model: string }> => ({ text: await chat(systemParts, messages, opts), model: 'claude-sonnet-5-5' }),
    withRetry: <T>(fn: () => Promise<T>): Promise<T> => fn(),
    getClientForTenant: async (clientId: string, botId: string | null) => ({
      messages: {
        create: async (params: { system: string; messages: ChatMessageLike[] }) => {
          const call = record({ kind: 'extraction', clientId, botId, system: params.system, messages: params.messages.map((m) => ({ role: m.role, content: m.content })) });
          return { content: [{ type: 'text', text: llmBehavior.extraction(call) }] };
        },
      },
    }),
  };
}
