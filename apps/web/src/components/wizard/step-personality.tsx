'use client';

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslations } from 'next-intl';
import { BOT_REFUSAL_FIELDS as REFUSAL_FIELDS, IDENTITY_FIELDS, LANGUAGE_LABELS, buildBotPayload, hasDefaultLanguagePersonality, leadFieldProblem, nextSlug, type IdentityErrors, type WizardState, type LangPersonality } from '@/lib/bot-draft';
import { apiFetch, isOrgChanged } from '@/lib/api-fetch';
import { FieldError } from '@/components/feedback/field-error';
import { InlineError } from '@/components/feedback/inline-error';
import { useMutate } from '@/components/feedback/use-mutate';
import { StepCounter } from './stepper';

/**
 * Tons proposés : la valeur est le texte que le moteur insère tel quel dans la consigne de l'agent IA (texte libre, il n'en
 * dépend d'aucune valeur) et qui reste donc identique quelle que soit la langue de l'interface (contre-audit D-4) ;
 * seul l'affichage passe par `wizard.tones.<clé>`.
 */
const TONES = [
  { value: 'Chaleureux', key: 'warm' },
  { value: 'Professionnel', key: 'professional' },
  { value: 'Concis', key: 'concise' },
  { value: 'Enthousiaste', key: 'enthusiastic' },
  { value: 'Formel', key: 'formal' },
] as const;
const LEAD_ERROR_ID = 'lead-error';
const LEAD_ADD_REASON_ID = 'lead-add-reason';
const PERSONALITY_ERROR_ID = 'personality-error';
const REASON_ID = 'create-reason';
const RAW_ID = 'personality-raw';
/** Champs de prompt (spec 12.2, variante A) : pleine largeur, redimensionnables en hauteur seulement. */
const TEXTAREA = 'block w-full resize-y rounded-lg border border-border bg-surface px-3.5 py-3 leading-normal text-fg focus:border-accent-ink focus:outline-none';

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  createdBotId: string | null;
  /**
   * `entityId` : entité enregistrée par le moteur pour l'agent IA (`null` si la réponse n'en porte pas) ; `sent` :
   * l'état envoyé, ce que le moteur a désormais.
   */
  onCreated: (id: string, entityId: number | null, sent: WizardState) => void;
  /** Le moteur refuse un champ de l'étape 1 : l'assistant y revient, le champ porte son message. */
  onIdentityRefused: (errors: IdentityErrors) => void;
  onBack: () => void;
  /**
   * Compteur des refus de la personnalité de la langue par défaut survenus hors de cette étape (renvoi avant un saut
   * du stepper) : chaque nouvelle valeur positive les montre comme un refus de « Créer et tester ».
   */
  personalityRefusal?: number;
  /** Texte du champ de lead tapé sans « Ajouter » : une saisie que la sortie perdrait (relecture tâche 13, M-1). */
  onLeadDraftChange?: (text: string) => void;
  /** Texte tapé laissé à la dernière visite de l'étape : l'assistant le garde et le rend au retour. */
  initialLeadDraft?: string;
  /** Verrou d'envoi partagé avec l'assistant : un seul envoi à la fois, d'ici ou d'un saut du stepper (re-relecture N-3). */
  sendLock?: MutableRefObject<boolean>;
}

function entityIdOf(bot: unknown): number | null {
  const id = typeof bot === 'object' && bot !== null ? (bot as { entity_id?: unknown }).entity_id : null;
  return typeof id === 'number' ? id : null;
}

export function StepPersonality({ state, update, createdBotId, onCreated, onIdentityRefused, onBack, personalityRefusal = 0, onLeadDraftChange, sendLock, initialLeadDraft = '' }: Props) {
  const t = useTranslations('wizard');
  const [lang, setLang] = useState(state.defaultLanguage);
  const [advanced, setAdvanced] = useState(false);
  const [leadInput, setLeadInputState] = useState(initialLeadDraft);
  const leadDraftRef = useRef(onLeadDraftChange);
  leadDraftRef.current = onLeadDraftChange;
  const setLeadInput = (text: string) => {
    setLeadInputState(text);
    leadDraftRef.current?.(text);
  };
  const [busy, setBusy] = useState(false);
  const ownLock = useRef(false);
  const lock = sendLock ?? ownLock;
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
  // Nom de la langue au milieu d'une phrase (minuscule en français) ; le libellé de l'assistant (Français) reste pour les boutons.
  const defaultLabel = t.has(`languageInSentence.${state.defaultLanguage}`) ? t(`languageInSentence.${state.defaultLanguage}`) : state.defaultLanguage;

  // Refus de la personnalité venu d'un renvoi hors de l'étape : montré comme celui de « Créer et tester ».
  useEffect(() => {
    if (personalityRefusal <= 0) return;
    setLang(state.defaultLanguage);
    setPersonalityError(t('defaultLanguageMissing', { language: defaultLabel }));
    document.getElementById('role')?.focus();
    // Seul un nouveau refus compte, pas un changement de langue ou de texte.
  }, [personalityRefusal]);

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
    // Un envoi est déjà en cours (ici ou depuis le stepper de l'assistant) : rien de plus.
    if (lock.current) return;
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
    lock.current = true;
    setBusy(true);
    try {
      let slug = state.slug;
      let outcome = await send(draft, slug);
      if (outcome.status === 'changed') return;
      if (!createdBotId && outcome.status === 'refused' && outcome.reason === 'bot.id_taken') {
        let taken: string[];
        try {
          const list = await apiFetch('/api/bots');
          // Organisation changée dans un autre onglet : apiFetch recharge la page, rien à afficher.
          if (await isOrgChanged(list)) return;
          if (!list.ok) throw new Error(`HTTP ${list.status}`);
          taken = ((await list.json()) as { bot_id: string }[]).map((b) => b.bot_id);
        } catch (err) {
          // Message seul : jamais l'objet d'erreur dans un journal.
          console.error('[Wizard] relecture des agents IA impossible', err instanceof Error ? err.message : 'erreur inconnue');
          setFormError({ message: t('createError'), reference: null });
          return;
        }
        slug = nextSlug(state.slug, taken);
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
        onCreated(botId, entityIdOf(bot), { ...draft, slug });
        return;
      }
      const { failure } = outcome;
      // Audit §5.1 : un champ absent de cet écran ramène à l'écran qui le porte.
      const identity: IdentityErrors = Object.fromEntries(
        IDENTITY_FIELDS.flatMap((field) => (failure.fieldErrors[field] !== undefined ? [[field, failure.fieldErrors[field]]] : [])),
      );
      if (Object.keys(identity).length > 0) {
        onIdentityRefused(identity);
        return;
      }
      if (failure.fieldErrors.system_prompt !== undefined) {
        // Texte de l'interface qui nomme la langue : le texte du moteur parle de « prompt ».
        setLang(state.defaultLanguage);
        setPersonalityError(t('defaultLanguageMissing', { language: defaultLabel }));
        // contre-audit D-3 (audit §5.1) : le focus va au premier champ de la personnalité refusée.
        document.getElementById('role')?.focus();
        return;
      }
      setFormError({ message: failure.message, reference: failure.reference });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const canSubmit = hasDefaultLanguagePersonality(state);

  return (
    // Variante A de la maquette : la carte prend toute la largeur de la zone de contenu (champs agrandis, spec 12.2).
    <div className="w-full pb-16">
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
              <button key={tone.value} onClick={() => toggleTone(tone.value)} className={`rounded-full border-2 px-3.5 py-2 text-sm font-medium ${p.tones.includes(tone.value) ? 'border-accent-ink bg-accent-soft text-accent-ink' : 'border-border text-fg'}`}>{t(`tones.${tone.key}`)}</button>
            ))}
          </div>
        </div>

        <label className="mt-5 mb-1.5 block font-semibold text-fg" htmlFor="objective">{t('objective')}</label>
        <textarea id="objective" rows={3} className={TEXTAREA} value={p.objective} onChange={(e) => setP({ objective: e.target.value })} />

        <label className="mt-5 mb-1.5 block font-semibold text-fg" htmlFor="info">{t('info')}</label>
        <textarea id="info" className={`min-h-[300px] ${TEXTAREA}`} value={p.info} onChange={(e) => setP({ info: e.target.value })} />

        <div className="mt-3.5 rounded-xl border border-dashed border-border">
          <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} aria-controls={RAW_ID}
            className="flex w-full items-center rounded-xl bg-bg px-4 py-3 text-left text-sm font-semibold text-fg">
            <span aria-hidden="true" className="mr-1.5">{advanced ? '▾' : '▸'}</span>{t('advanced')}
          </button>
          {advanced && (
            <div className="border-t border-dashed border-border p-4">
              <textarea id={RAW_ID} aria-label={t('advanced')} className={`min-h-[320px] font-mono text-[12.5px] ${TEXTAREA}`}
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
          <textarea aria-label={t('welcomeSection')} className={`min-h-[96px] ${TEXTAREA}`}
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
          <button type="button" onClick={addLead} disabled={leadInput.trim() === ''} aria-describedby={leadInput.trim() === '' ? LEAD_ADD_REASON_ID : undefined}
            className="rounded-md border border-border px-3 py-1 text-sm font-semibold text-fg hover:bg-surface-subtle disabled:opacity-50">{t('leadAdd')}</button>
        </div>
        <span id={LEAD_ADD_REASON_ID} className="sr-only">{t('leadAddReason')}</span>
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
