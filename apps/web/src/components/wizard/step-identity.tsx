'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { slugify, type WizardState, type LangPersonality } from '@/lib/bot-draft';

const ALL_LANGS = ['fr', 'en'] as const;
const LANG_LABEL: Record<string, string> = { fr: 'Français', en: 'English' };

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}

function blankLang(): LangPersonality {
  return { mode: 'guided', role: '', tones: [], objective: '', info: '', raw: '' };
}

export function StepIdentity({ state, update, onNext, onBack }: Props) {
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

  const canContinue = state.name.trim().length > 0 && state.slug.length > 0;

  return (
    <div className="mx-auto max-w-xl px-5 pb-16">
      <div className="rounded-xl border border-border bg-surface p-8">
        <div className="text-xs font-semibold uppercase tracking-wider text-accent-hover">1 / 3</div>
        <h1 className="mt-1.5 font-serif text-2xl text-fg">{t('identityTitle')}</h1>
        <p className="mt-1.5 mb-6 text-muted">{t('identityLead')}</p>

        <label className="mb-1.5 block font-semibold text-fg" htmlFor="agent-name">{t('name')}</label>
        <input id="agent-name" className="w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent focus:outline-none"
          value={state.name} placeholder={t('namePlaceholder')} onChange={(e) => onName(e.target.value)} />
        <input aria-label="slug" className="mt-2 w-full bg-transparent font-mono text-xs text-muted focus:text-fg focus:outline-none"
          value={state.slug} onChange={(e) => { setSlugEdited(true); update({ slug: slugify(e.target.value) }); }} />
        <p className="mt-1 font-mono text-xs text-muted-2">{t('slugHint', { slug: state.slug || '—' })}</p>

        <div className="mt-6">
          <span className="mb-2 block font-semibold text-fg">{t('languages')}</span>
          <div className="flex flex-wrap gap-2.5">
            {ALL_LANGS.map((lang) => {
              const on = state.languages.includes(lang);
              return (
                <button key={lang} type="button" onClick={() => toggleLang(lang)}
                  className={`rounded-full border-2 px-3.5 py-2 text-sm font-medium ${on ? 'border-accent bg-accent-soft text-accent-hover' : 'border-border text-fg'}`}>
                  {on ? '✓ ' : ''}{LANG_LABEL[lang]}{state.defaultLanguage === lang ? ` ★ ${t('defaultBadge')}` : ''}
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
                className={`rounded-lg border-2 px-4 py-2 text-sm font-semibold ${state.defaultLanguage === lang ? 'border-brand bg-[#EAF2EE] text-brand-deep' : 'border-border text-fg'}`}>
                {LANG_LABEL[lang]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-7 flex items-center justify-between">
          <button onClick={onBack} className="font-semibold text-muted hover:text-fg">← {t('cancel')}</button>
          <button onClick={onNext} disabled={!canContinue}
            className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50">{t('continue')} →</button>
        </div>
      </div>
    </div>
  );
}
