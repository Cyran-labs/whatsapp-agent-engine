'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LANGUAGE_LABELS, buildBotPayload, hasDefaultLanguagePersonality, leadFieldProblem, nextSlug, type WizardState, type LangPersonality } from '@/lib/bot-draft';
import { apiFetch, isOrgChanged } from '@/lib/api-fetch';
import { FieldError } from '@/components/feedback/field-error';
import { InlineError } from '@/components/feedback/inline-error';
import { useMutate } from '@/components/feedback/use-mutate';
import { StepCounter, WIZARD_PANE } from './stepper';

const TONES = ['Chaleureux', 'Professionnel', 'Concis', 'Enthousiaste', 'Formel'];
/** Champs de la création que l'écran sait montrer : `entity_id` (étape 1) et `system_prompt` (onglet de la langue par défaut). */
const REFUSAL_FIELDS = ['entity_id', 'system_prompt'] as const;
const LEAD_ERROR_ID = 'lead-error';
const PERSONALITY_ERROR_ID = 'personality-error';
const REASON_ID = 'create-reason';

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  createdBotId: string | null;
  /** `entityId` : entité enregistrée par le moteur pour l'agent IA (`null` si la réponse n'en porte pas). */
  onCreated: (id: string, entityId: number | null) => void;
  /** Le moteur refuse l'entité : l'assistant revient à l'étape 1, où le champ Entité porte `message`. */
  onEntityRefused: (message: string) => void;
  onBack: () => void;
}

function entityIdOf(bot: unknown): number | null {
  const id = typeof bot === 'object' && bot !== null ? (bot as { entity_id?: unknown }).entity_id : null;
  return typeof id === 'number' ? id : null;
}

export function StepPersonality({ state, update, createdBotId, onCreated, onEntityRefused, onBack }: Props) {
  const t = useTranslations('wizard');
  const [lang, setLang] = useState(state.defaultLanguage);
  const [advanced, setAdvanced] = useState(false);
  const [leadInput, setLeadInput] = useState('');
  const [busy, setBusy] = useState(false);
  const mutate = useMutate('Wizard');
  // Refus sans emplacement propre : sous le bouton. Refus de la langue par défaut : sur son onglet.
  const [formError, setFormError] = useState<{ message: string; reference: string | null } | null>(null);
  const [personalityError, setPersonalityError] = useState<string | null>(null);
  const [leadError, setLeadError] = useState<string | null>(null);

  const p: LangPersonality = state.perLang[lang] ?? { mode: 'guided', role: '', tones: [], objective: '', info: '', raw: '' };
  const setP = (patch: Partial<LangPersonality>) => {
    setPersonalityError(null);
    update({ perLang: { ...state.perLang, [lang]: { ...p, ...patch } } });
  };
  const defaultInError = personalityError !== null;

  const toggleTone = (tone: string) => {
    const has = p.tones.includes(tone);
    setP({ tones: has ? p.tones.filter((x) => x !== tone) : [...p.tones, tone] });
  };

  /** Ajoute le champ tapé ; false (message sous le champ) s'il est refusé. Sans texte, rien à faire. */
  const addLead = (): boolean => {
    const problem = leadFieldProblem(leadInput, state.leadFields);
    if (problem !== null) {
      setLeadError(t('leadDuplicate'));
      return false;
    }
    const v = leadInput.trim();
    if (v) update({ leadFields: [...state.leadFields, v] });
    setLeadInput('');
    return true;
  };

  async function send(draft: WizardState, slug: string) {
    const payload = buildBotPayload({ ...draft, slug });
    if (createdBotId) return mutate(`/api/bots/${encodeURIComponent(createdBotId)}`, 'PATCH', payload, REFUSAL_FIELDS);
    return mutate('/api/bots', 'POST', payload, REFUSAL_FIELDS);
  }

  const submit = async () => {
    setFormError(null);
    // Q-12 : un champ tapé sans Entrée n'est pas perdu. Valide, il part avec la création ; refusé, il la bloque.
    const pending = leadInput.trim();
    if (leadFieldProblem(leadInput, state.leadFields) !== null) {
      setLeadError(t('leadDuplicate'));
      return;
    }
    const draft: WizardState = pending ? { ...state, leadFields: [...state.leadFields, pending] } : state;
    if (pending) {
      update({ leadFields: draft.leadFields });
      setLeadInput('');
    }
    setBusy(true);
    try {
      let slug = state.slug;
      let outcome = await send(draft, slug);
      if (outcome.status === 'changed') return;
      if (!createdBotId && outcome.status === 'refused' && outcome.reason === 'bot.id_taken') {
        const list = await apiFetch('/api/bots');
        // Organisation changée dans un autre onglet : apiFetch recharge la page, rien à afficher.
        if (await isOrgChanged(list)) return;
        if (!list.ok) {
          setFormError({ message: t('createError'), reference: null });
          return;
        }
        slug = nextSlug(state.slug, ((await list.json()) as { bot_id: string }[]).map((b) => b.bot_id));
        update({ slug });
        outcome = await send(draft, slug);
        if (outcome.status === 'changed') return;
      }
      if (outcome.status === 'ok') {
        const bot = await outcome.res.json().catch(() => null) as { bot_id?: unknown } | null;
        const botId = createdBotId ?? (typeof bot?.bot_id === 'string' ? bot.bot_id : null);
        if (botId === null) {
          setFormError({ message: t('createError'), reference: null });
          return;
        }
        onCreated(botId, entityIdOf(bot));
        return;
      }
      const { failure } = outcome;
      // Audit §5.1 : un champ absent de cet écran ramène à l'écran qui le porte.
      if (failure.fieldErrors.entity_id !== undefined) {
        onEntityRefused(failure.fieldErrors.entity_id);
        return;
      }
      if (failure.fieldErrors.system_prompt !== undefined) {
        setLang(state.defaultLanguage);
        setPersonalityError(failure.fieldErrors.system_prompt);
        return;
      }
      setFormError({ message: failure.message, reference: failure.reference });
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = hasDefaultLanguagePersonality(state);
  const defaultLabel = LANGUAGE_LABELS[state.defaultLanguage] ?? state.defaultLanguage;

  return (
    <div className={`${WIZARD_PANE} pb-16`}>
      <div className="rounded-xl border border-border bg-surface p-8">
        <StepCounter step={2} />
        <h1 className="mt-1.5 font-serif text-2xl text-fg">{t('personalityTitle')}</h1>
        <p className="mt-1.5 mb-6 text-muted">{t('personalityLead')}</p>

        {state.languages.length > 1 && (
          <div className="mb-6 flex w-fit gap-1.5 rounded-lg border border-border p-1">
            {state.languages.map((l) => {
              const inError = defaultInError && l === state.defaultLanguage;
              return (
                <button key={l} onClick={() => setLang(l)} aria-describedby={inError ? PERSONALITY_ERROR_ID : undefined}
                  className={`rounded-md border px-4 py-1.5 font-semibold ${inError ? 'border-danger' : 'border-transparent'} ${lang === l ? 'bg-brand-deep text-[#E6EFEA]' : inError ? 'text-danger' : 'text-muted'}`}>{LANGUAGE_LABELS[l]}</button>
              );
            })}
          </div>
        )}

        {defaultInError && lang === state.defaultLanguage && <div className="mb-3"><FieldError id={PERSONALITY_ERROR_ID} message={personalityError} /></div>}
        <label className="mb-1.5 block font-semibold text-fg" htmlFor="role">{t('role')}</label>
        <input id="role" className="w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent-ink focus:outline-none" value={p.role} onChange={(e) => setP({ role: e.target.value, mode: 'guided' })}
          aria-invalid={defaultInError && lang === state.defaultLanguage ? true : undefined} />

        <div className="mt-5">
          <span className="mb-2 block font-semibold text-fg">{t('tone')}</span>
          <div className="flex flex-wrap gap-2.5">
            {TONES.map((tone) => (
              <button key={tone} onClick={() => toggleTone(tone)} className={`rounded-full border-2 px-3.5 py-2 text-sm font-medium ${p.tones.includes(tone) ? 'border-accent-ink bg-accent-soft text-accent-ink' : 'border-border text-fg'}`}>{tone}</button>
            ))}
          </div>
        </div>

        <label className="mt-5 mb-1.5 block font-semibold text-fg" htmlFor="objective">{t('objective')}</label>
        <input id="objective" className="w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent-ink focus:outline-none" value={p.objective} onChange={(e) => setP({ objective: e.target.value })} />

        <label className="mt-5 mb-1.5 block font-semibold text-fg" htmlFor="info">{t('info')}</label>
        <textarea id="info" className="min-h-[74px] w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent-ink focus:outline-none" value={p.info} onChange={(e) => setP({ info: e.target.value })} />

        <div className="mt-3 rounded-xl border border-dashed border-border">
          <button onClick={() => setAdvanced((a) => !a)} className="flex w-full items-center justify-between bg-bg px-4 py-3 text-left text-sm font-semibold text-fg">
            <span>{advanced ? '▾' : '▸'} {t('advanced')}</span><span className="text-xs font-normal text-muted-2">{t('advancedHint')}</span>
          </button>
          {advanced && (
            <div className="border-t border-dashed border-border p-4">
              <textarea className="min-h-[130px] w-full rounded-lg border border-border bg-surface px-3.5 py-3 font-mono text-xs text-fg focus:border-accent-ink focus:outline-none"
                value={p.raw} onChange={(e) => setP({ raw: e.target.value, mode: 'raw' })} />
            </div>
          )}
        </div>

        <div className="my-6 h-px bg-border" />
        <div className="font-semibold text-fg">{t('welcomeSection')}</div>
        <div className="mt-3 mb-3 flex items-center justify-between rounded-lg border border-border px-4 py-3">
          <span className="text-fg">{t('welcomeToggle')}</span>
          <button onClick={() => update({ welcomeEnabled: !state.welcomeEnabled })} aria-pressed={state.welcomeEnabled}
            className={`relative h-6 w-11 rounded-full ${state.welcomeEnabled ? 'bg-success' : 'bg-muted-2'}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${state.welcomeEnabled ? 'right-0.5' : 'left-0.5'}`} />
          </button>
        </div>
        {state.welcomeEnabled && (
          <textarea className="min-h-[60px] w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent-ink focus:outline-none"
            value={state.welcome[lang] ?? ''} onChange={(e) => update({ welcome: { ...state.welcome, [lang]: e.target.value } })} />
        )}

        <div className="my-6 h-px bg-border" />
        <div className="font-semibold text-fg">{t('leadSection')}</div>
        <p className="mb-3 text-sm text-muted">{t('leadHint')}</p>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
          {state.leadFields.map((f) => (
            <span key={f} className="flex items-center gap-1.5 rounded-md bg-surface-subtle px-2.5 py-1 text-sm font-semibold text-brand-deep">
              {f}<button onClick={() => update({ leadFields: state.leadFields.filter((x) => x !== f) })} className="text-muted-2">✕</button>
            </span>
          ))}
          <input aria-label={t('addField')} className="min-w-[140px] flex-1 bg-transparent px-1.5 py-1 text-sm focus:outline-none" placeholder={t('addField')}
            value={leadInput} onChange={(e) => { setLeadInput(e.target.value); setLeadError(null); }}
            aria-invalid={leadError !== null ? true : undefined} aria-describedby={leadError !== null ? LEAD_ERROR_ID : undefined}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLead(); } }} />
          <button type="button" onClick={addLead} disabled={leadInput.trim() === ''}
            className="rounded-md border border-border px-3 py-1 text-sm font-semibold text-fg hover:bg-surface-subtle disabled:opacity-50">{t('leadAdd')}</button>
        </div>
        <FieldError id={LEAD_ERROR_ID} message={leadError} />
        <p className="mt-2 text-[12.5px] text-muted">{t('leadNote')}</p>

        <div className="mt-7 flex items-center justify-between">
          <button onClick={onBack} className="font-semibold text-muted hover:text-fg">← {t('back')}</button>
          <button onClick={submit} disabled={!canSubmit || busy} aria-describedby={canSubmit ? undefined : REASON_ID}
            className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50">
            {busy ? t('creating') : t('createAndTest')} →
          </button>
        </div>
        {!canSubmit && <p id={REASON_ID} className="mt-2 text-right text-[12.5px] text-muted">{t('defaultLanguageRequired', { language: defaultLabel })}</p>}
        {formError && <div className="mt-4"><InlineError message={formError.message} reference={formError.reference} /></div>}
      </div>
    </div>
  );
}
