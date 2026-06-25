import type { PersonalityFields } from '../database/types.js';

interface Template {
  you: (role: string) => string;
  tone: (tones: string) => string;
  objective: (o: string) => string;
  info: (i: string) => string;
  reply: string;
}

// Contenu francais/anglais : accents volontaires (chaines de contenu, pas des identifiants).
const TEMPLATES: Record<string, Template> = {
  fr: {
    you: (role) => `Tu es ${role}.`,
    tone: (tones) => `Ton ton : ${tones}.`,
    objective: (o) => `Ton objectif principal : ${o}.`,
    info: (i) => `Informations à connaître : ${i}.`,
    reply: 'Réponds en français, en messages courts adaptés à WhatsApp.',
  },
  en: {
    you: (role) => `You are ${role}.`,
    tone: (tones) => `Your tone: ${tones}.`,
    objective: (o) => `Your main objective: ${o}.`,
    info: (i) => `Useful information: ${i}.`,
    reply: 'Reply in English, in short WhatsApp-friendly messages.',
  },
};

export function isComposableLanguage(lang: string): boolean {
  return lang in TEMPLATES;
}

export function composeSystemPrompt(fields: PersonalityFields, lang: string): string {
  const tpl = TEMPLATES[lang];
  if (!tpl) throw new Error(`[Personality] Pas de template pour la langue: ${lang}`);
  const lines: string[] = [tpl.you(fields.role.trim())];
  const tones = fields.tones.map((t) => t.trim()).filter(Boolean);
  if (tones.length) lines.push(tpl.tone(tones.join(', ')));
  if (fields.objective.trim()) lines.push(tpl.objective(fields.objective.trim()));
  if (fields.info.trim()) lines.push(tpl.info(fields.info.trim()));
  lines.push(tpl.reply);
  return lines.join('\n');
}
