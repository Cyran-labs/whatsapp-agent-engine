/**
 * Modèles Claude appelés par le moteur et lecture de leurs réponses.
 *
 * Les modèles de la génération 5.5 réfléchissent par défaut : une réponse peut commencer par un bloc
 * `thinking` (vide, le raisonnement n'est pas renvoyé) avant le texte. On ne lit donc jamais le premier
 * bloc à l'aveugle : seuls les blocs `text` forment la réponse au contact.
 */
import { CLAUDE_CHAT_MODELS } from '@wabagent/contracts';

export interface ModelPlanStep {
  model: string;
  plan: string;
  label: string;
}

const LABELS: Record<(typeof CLAUDE_CHAT_MODELS)[number], string> = {
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-5-5': 'Haiku 5.5',
};

/**
 * Cascade de conversation : un modèle en surcharge, en erreur, qui refuse ou ne rend aucun texte laisse
 * la place au suivant. Ordre du contrat partagé avec le back-office (`CLAUDE_CHAT_MODELS`).
 */
export const CHAT_MODEL_CASCADE: readonly ModelPlanStep[] = CLAUDE_CHAT_MODELS.map((model, i) => ({
  model,
  plan: String.fromCharCode(65 + i),
  label: LABELS[model],
}));

/**
 * Effort de réflexion des réponses aux contacts : bas. Mesuré le 9 nov. 2026 sur Sonnet 5.5 : réponse
 * directe sans bloc de réflexion, 1,4 s au lieu de 2,1 s, deux fois moins de jetons de sortie.
 */
export const CHAT_EFFORT = 'low' as const;

/** Plafond de jetons d'une réponse ; la réflexion éventuelle compte dedans. */
export const CHAT_MAX_TOKENS = 4096;

/** Extraction des informations du lead, en arrière-plan : modèle rapide et économique. */
export const LEAD_EXTRACTION_MODEL = 'claude-haiku-5-5';
export const LEAD_EXTRACTION_MAX_TOKENS = 1024;

/** Tout modèle que le moteur peut appeler ; chacun doit avoir un tarif (test de `seed-pricing`). */
export const CALLABLE_MODELS: readonly string[] = [...new Set([...CLAUDE_CHAT_MODELS, LEAD_EXTRACTION_MODEL])];

interface ReplyBlock {
  type: string;
  text?: string;
  thinking?: string;
}

export interface ReplyMessage {
  content: readonly ReplyBlock[];
  stop_reason?: string | null;
  stop_details?: { type?: string; category?: string | null; explanation?: string | null } | null;
}

export type Reply =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'refusal'; category: string | null }
  | { kind: 'empty' };

/** Lit une réponse de l'API : texte des blocs `text`, refus de sécurité, ou réponse vide. */
export function readReply(message: ReplyMessage): Reply {
  if (message.stop_reason === 'refusal') {
    return { kind: 'refusal', category: message.stop_details?.category ?? null };
  }
  const text = message.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
  if (text.trim() === '') return { kind: 'empty' };
  return { kind: 'text', text, truncated: message.stop_reason === 'max_tokens' };
}
