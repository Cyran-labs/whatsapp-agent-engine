'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { EntitySummary } from '@/lib/entities';
import { LANGUAGE_LABELS, slugify, type WizardState, type LangPersonality } from '@/lib/bot-draft';
import { Skeleton } from '@/components/ui/skeleton';
import { FieldError } from '@/components/feedback/field-error';
import { InlineError } from '@/components/feedback/inline-error';
import { LoadError } from '@/components/feedback/load-error';
import { StepCounter, WIZARD_PANE } from './stepper';

const ALL_LANGS = ['fr', 'en'] as const;
const ENTITY_ERROR_ID = 'agent-entity-error';
const ENTITIES_REASON_ID = 'entities-reason';

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  /** Entités actives de l'organisation. */
  entities: EntitySummary[];
  entitiesLoading: boolean;
  /** Liste des entités illisible : l'étape affiche l'échec et la suite reste bloquée. */
  entitiesFailed: boolean;
  onRetryEntities: () => void;
  /** Refus de l'entité par le moteur à la création : affiché sous le champ Entité. */
  entityError: string | null;
  onNext: () => void;
  onBack: () => void;
}

function blankLang(): LangPersonality {
  return { mode: 'guided', role: '', tones: [], objective: '', info: '', raw: '' };
}

export function StepIdentity({ state, update, entities, entitiesLoading, entitiesFailed, onRetryEntities, entityError, onNext, onBack }: Props) {
  const t = useTranslations('wizard');
  const [slugEdited, setSlugEdited] = useState(false);

  const onName = (name: string) => {
    update({ name, ...(slugEdited ? {} : { slug: slugify(name) }) });
  };

  const toggleLang = (lang: string) => {
    const has = state.languages.includes(lang);
    if (has && state.languages.length === 1) return; // au moins une langue
    const languages = has ? state.languages.filter((l) => l !== lang) : [...state.languages, lang];
    const perLang = { ...state.perLang };
    if (!has) perLang[lang] = blankLang();
    const defaultLanguage = languages.includes(state.defaultLanguage) ? state.defaultLanguage : languages[0];
    update({ languages, perLang, defaultLanguage });
  };

  // Le champ n'existe qu'avec plusieurs entités actives ; le moteur exige alors entity_id.
  const askEntity = entities.length > 1;
  const canContinue =
    state.name.trim().length > 0 && state.slug.length > 0 && !entitiesLoading && !entitiesFailed && (!askEntity || state.entityId !== null);

  return (
    <div className={`${WIZARD_PANE} pb-16`}>
      <div className="rounded-xl border border-border bg-surface p-8">
        <StepCounter step={1} />
        <h1 className="mt-1.5 font-serif text-2xl text-fg">{t('identityTitle')}</h1>
        <p className="mt-1.5 mb-6 text-muted">{askEntity ? t('identityLeadWithEntity') : t('identityLead')}</p>

        <label className="mb-1.5 block font-semibold text-fg" htmlFor="agent-name">{t('name')}</label>
        <input id="agent-name" className="w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent-ink focus:outline-none"
          value={state.name} placeholder={t('namePlaceholder')} onChange={(e) => onName(e.target.value)} />
        <input aria-label="slug" className="mt-2 w-full bg-transparent font-mono text-xs text-muted focus:text-fg focus:outline-none"
          value={state.slug} onChange={(e) => { setSlugEdited(true); update({ slug: slugify(e.target.value) }); }} />
        <p className="mt-1 font-mono text-xs text-muted-2">{t('slugHint', { slug: state.slug || '…' })}</p>

        {entitiesLoading && (
          <div data-entity-skeleton="" aria-hidden="true" className="mt-[22px]">
            <Skeleton className="mb-1.5 h-4 w-16" />
            <Skeleton className="h-[50px] w-full rounded-lg" />
          </div>
        )}

        {entitiesFailed && !entitiesLoading && (
          <div className="mt-[22px]">
            <LoadError message={t('entitiesLoadFailed')} onRetry={onRetryEntities} />
          </div>
        )}

        {askEntity && (
          <div className="mt-[22px]">
            <label className="mb-1.5 block font-semibold text-fg" htmlFor="agent-entity">{t('entity')}</label>
            <select id="agent-entity" value={state.entityId ?? ''}
              onChange={(e) => update({ entityId: e.target.value === '' ? null : Number(e.target.value) })}
              aria-invalid={entityError !== null ? true : undefined}
              aria-describedby={entityError !== null ? ENTITY_ERROR_ID : undefined}
              className="w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent-ink focus:outline-none">
              <option value="">{t('entityPlaceholder')}</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <FieldError id={ENTITY_ERROR_ID} message={entityError} />
            <p className="mt-1.5 text-xs text-muted">{t('entityHint')}</p>
          </div>
        )}

        {/* Le moteur refuse l'entité alors que le champ n'a pas lieu d'être affiché (une entité active au plus) : le refus se lit ici. */}
        {!askEntity && !entitiesLoading && entityError !== null && (
          <div className="mt-[22px]"><InlineError message={entityError} /></div>
        )}

        <div className="mt-[22px]">
          <span className="mb-2 block font-semibold text-fg">{t('languages')}</span>
          <div className="flex flex-wrap gap-2.5">
            {ALL_LANGS.map((lang) => {
              const on = state.languages.includes(lang);
              return (
                <button key={lang} type="button" onClick={() => toggleLang(lang)}
                  className={`rounded-full border-2 px-3.5 py-2 text-sm font-medium ${on ? 'border-accent-ink bg-accent-soft text-accent-ink' : 'border-border text-fg'}`}>
                  {on ? '✓ ' : ''}{LANGUAGE_LABELS[lang]}{state.defaultLanguage === lang ? ` ★ ${t('defaultBadge')}` : ''}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-muted-2">{t('languagesHint')}</p>
        </div>

        <div className="mt-6">
          <span className="mb-2 block font-semibold text-fg">{t('defaultLanguage')}</span>
          <div className="flex gap-2.5">
            {state.languages.map((lang) => (
              <button key={lang} type="button" onClick={() => update({ defaultLanguage: lang })}
                className={`rounded-lg border-2 px-4 py-2 text-sm font-semibold ${state.defaultLanguage === lang ? 'border-brand bg-surface-subtle text-brand-deep' : 'border-border text-fg'}`}>
                {LANGUAGE_LABELS[lang]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-7 flex items-center justify-between">
          <button onClick={onBack} className="font-semibold text-muted hover:text-fg">← {t('cancel')}</button>
          <button onClick={onNext} disabled={!canContinue}
            aria-describedby={entitiesFailed ? ENTITIES_REASON_ID : undefined}
            className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50">{t('continue')} →</button>
        </div>
        {entitiesFailed && !entitiesLoading && <p id={ENTITIES_REASON_ID} className="mt-2 text-right text-[12.5px] text-muted">{t('entitiesBlockedReason')}</p>}
      </div>
    </div>
  );
}
