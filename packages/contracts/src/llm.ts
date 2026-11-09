import { z } from 'zod';

/**
 * Modèles Claude que le moteur sait appeler pour converser avec un contact, dans l'ordre de la cascade
 * (le premier est le modèle par défaut). Un modèle imposé à un agent IA doit appartenir à cette liste :
 * un identifiant libre pourrait viser un modèle retiré ou sans tarif connu.
 */
export const CLAUDE_CHAT_MODELS = ['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-haiku-5-5'] as const;
export const ClaudeChatModel = z.enum(CLAUDE_CHAT_MODELS);
export type ClaudeChatModel = z.infer<typeof ClaudeChatModel>;
