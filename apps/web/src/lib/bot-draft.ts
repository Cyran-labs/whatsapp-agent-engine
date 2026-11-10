import type { CreateBotInput } from '@wabagent/contracts';

export interface LangPersonality {
  mode: 'guided' | 'raw';
  role: string;
  tones: string[];
  objective: string;
  info: string;
  raw: string;
}

export interface WizardState {
  name: string;
  slug: string;
  languages: string[];
  defaultLanguage: string;
  perLang: Record<string, LangPersonality>;
  welcomeEnabled: boolean;
  welcome: Record<string, string>;
  leadFields: string[];
  /** Entité de l'agent IA ; null quand l'organisation n'en a qu'une (le moteur l'attribue). */
  entityId: number | null;
}

/**
 * Champs de la création affichés à l'étape 1 (Identité). Un refus du moteur sur l'un d'eux ramène à cette étape
 * (audit §5.1). `bot_id` est l'identifiant technique, modifiable sous le nom (champ « Identifiant technique »).
 */
export const IDENTITY_FIELDS = ['name', 'bot_id', 'entity_id', 'languages', 'default_language'] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];
export type IdentityErrors = Partial<Record<IdentityField, string>>;

/** Libellés des langues proposées à l'agent IA. */
export const LANGUAGE_LABELS: Record<string, string> = { fr: 'Français', en: 'English' };

export function slugify(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function nextSlug(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/**
 * Pré-contrôle de la règle du moteur (`resolvePrompts`, bot-service.ts) : la langue par défaut doit avoir une
 * personnalité guidée avec un rôle, ou un prompt brut. Le moteur reste seul juge : son refus s'affiche s'il survient.
 */
export function hasDefaultLanguagePersonality(state: WizardState): boolean {
  const p = state.perLang[state.defaultLanguage];
  if (!p) return false;
  return p.mode === 'guided' ? p.role.trim().length > 0 : p.raw.trim().length > 0;
}

/** Motif de refus d'un champ à collecter saisi, null s'il peut être ajouté (vide : rien à ajouter). */
export function leadFieldProblem(input: string, existing: readonly string[]): 'duplicate' | null {
  const value = input.trim();
  return value !== '' && existing.includes(value) ? 'duplicate' : null;
}

export function buildBotPayload(state: WizardState): CreateBotInput {
  const personality: Record<string, { role: string; tones: string[]; objective: string; info: string }> = {};
  const systemPrompt: Record<string, string> = {};
  for (const lang of state.languages) {
    const p = state.perLang[lang];
    if (!p) continue;
    if (p.mode === 'guided' && p.role.trim()) {
      personality[lang] = { role: p.role.trim(), tones: p.tones, objective: p.objective.trim(), info: p.info.trim() };
    } else if (p.mode === 'raw' && p.raw.trim()) {
      systemPrompt[lang] = p.raw.trim();
    }
  }
  const welcomeMsg: Record<string, string> = {};
  for (const lang of state.languages) {
    if (state.welcome[lang]?.trim()) welcomeMsg[lang] = state.welcome[lang].trim();
  }
  return {
    bot_id: state.slug,
    name: state.name.trim(),
    default_language: state.defaultLanguage,
    languages: state.languages,
    system_prompt: systemPrompt,
    personality: Object.keys(personality).length ? personality : null,
    lead_fields: state.leadFields.map((f) => f.trim()).filter(Boolean).join(', '),
    welcome: { enabled: state.welcomeEnabled, message: welcomeMsg },
    error_messages: {},
    catalog: null,
    llm: null,
    crm: null,
    ...(state.entityId !== null ? { entity_id: state.entityId } : {}),
  } as CreateBotInput;
}
