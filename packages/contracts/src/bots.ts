import { z } from 'zod';

/** Contenu localisé : { "fr": "...", "en": "..." }. Au moins une langue, valeurs non vides. */
export const LocalizedInput = z.record(z.string().min(1));
export type LocalizedInput = z.infer<typeof LocalizedInput>;

export const PersonalityInput = z.object({
  role: z.string().min(1),
  tones: z.array(z.string()).default([]),
  objective: z.string().default(''),
  info: z.string().default(''),
});
export type PersonalityInput = z.infer<typeof PersonalityInput>;

export const LocalizedPersonality = z.record(PersonalityInput);
export type LocalizedPersonality = z.infer<typeof LocalizedPersonality>;

const botId = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'bot_id: minuscules, chiffres, tirets.');
const transport = z.enum(['meta-cloud', 'cm-com']);

export const CreateBotInput = z.object({
  bot_id: botId,
  name: z.string().min(1),
  transport,
  default_language: z.string().min(2).max(8).default('fr'),
  languages: z.array(z.string().min(2).max(8)).default(['fr']),
  system_prompt: LocalizedInput.default({}),
  personality: LocalizedPersonality.nullable().default(null),
  lead_fields: z.string().default(''),
  welcome: z.object({ enabled: z.boolean(), message: z.record(z.string()) }),
  error_messages: z.record(z.string()).default({}),
  catalog: z.object({ meta_catalog_id: z.string().optional() }).nullable().default(null),
  llm: z.object({ model: z.string().optional(), mode: z.string().optional() }).nullable().default(null),
  crm: z.object({ connector: z.string() }).nullable().default(null),
});
export type CreateBotInput = z.infer<typeof CreateBotInput>;

export const UpdateBotInput = CreateBotInput.partial().omit({ bot_id: true });
export type UpdateBotInput = z.infer<typeof UpdateBotInput>;

export const SetNumbersInput = z.object({ numbers: z.array(z.string()) });
export type SetNumbersInput = z.infer<typeof SetNumbersInput>;

export const SetBotStatusInput = z.object({ status: z.enum(['draft', 'active', 'paused']) });
export type SetBotStatusInput = z.infer<typeof SetBotStatusInput>;
