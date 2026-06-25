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
}

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
    transport: 'meta-cloud',
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
  } as CreateBotInput;
}
