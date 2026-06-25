'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { buildBotPayload, nextSlug, type WizardState, type LangPersonality } from '@/lib/bot-draft';

const LANG_LABEL: Record<string, string> = { fr: 'Français', en: 'English' };
const TONES = ['Chaleureux', 'Professionnel', 'Concis', 'Enthousiaste', 'Formel'];

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  createdBotId: string | null;
  onCreated: (id: string) => void;
  onBack: () => void;
}

export function StepPersonality({ state, update, createdBotId, onCreated, onBack }: Props) {
  const t = useTranslations('wizard');
  const [lang, setLang] = useState(state.defaultLanguage);
  const [advanced, setAdvanced] = useState(false);
  const [leadInput, setLeadInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const p: LangPersonality = state.perLang[lang] ?? { mode: 'guided', role: '', tones: [], objective: '', info: '', raw: '' };
  const setP = (patch: Partial<LangPersonality>) => update({ perLang: { ...state.perLang, [lang]: { ...p, ...patch } } });

  const toggleTone = (tone: string) => {
    const has = p.tones.includes(tone);
    setP({ tones: has ? p.tones.filter((x) => x !== tone) : [...p.tones, tone] });
  };

  const addLead = () => {
    const v = leadInput.trim();
    if (v && !state.leadFields.includes(v)) update({ leadFields: [...state.leadFields, v] });
    setLeadInput('');
  };

  async function postOrPatch(slug: string): Promise<Response> {
    const payload = buildBotPayload({ ...state, slug });
    if (createdBotId) return fetch(`/api/bots/${encodeURIComponent(createdBotId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  }

  const submit = async () => {
    setBusy(true); setError(false);
    try {
      if (createdBotId) {
        const res = await postOrPatch(state.slug);
        if (!res.ok) throw new Error('patch');
        onCreated(createdBotId);
        return;
      }
      let res = await postOrPatch(state.slug);
      if (res.status === 409) {
        const list = await (await fetch('/api/bots')).json() as { bot_id: string }[];
        const slug = nextSlug(state.slug, list.map((b) => b.bot_id));
        update({ slug });
        res = await postOrPatch(slug);
      }
      if (!res.ok) throw new Error('create');
      const bot = await res.json() as { bot_id: string };
      onCreated(bot.bot_id);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = state.languages.some((l) => {
    const x = state.perLang[l];
    return x && ((x.mode === 'guided' && x.role.trim()) || (x.mode === 'raw' && x.raw.trim()));
  });

  return (
    <div className="mx-auto max-w-2xl px-5 pb-16">
      <div className="rounded-xl border border-border bg-surface p-8">
        <div className="text-xs font-semibold uppercase tracking-wider text-accent-hover">2 / 3</div>
        <h1 className="mt-1.5 font-serif text-2xl text-fg">{t('personalityTitle')}</h1>
        <p className="mt-1.5 mb-6 text-muted">{t('personalityLead')}</p>

        {state.languages.length > 1 && (
          <div className="mb-6 flex w-fit gap-1.5 rounded-lg border border-border p-1">
            {state.languages.map((l) => (
              <button key={l} onClick={() => setLang(l)} className={`rounded-md px-4 py-1.5 font-semibold ${lang === l ? 'bg-brand-deep text-[#E6EFEA]' : 'text-muted'}`}>{LANG_LABEL[l]}</button>
            ))}
          </div>
        )}

        <label className="mb-1.5 block font-semibold text-fg" htmlFor="role">{t('role')}</label>
        <input id="role" className="w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent focus:outline-none" value={p.role} onChange={(e) => setP({ role: e.target.value, mode: 'guided' })} />

        <div className="mt-5">
          <span className="mb-2 block font-semibold text-fg">{t('tone')}</span>
          <div className="flex flex-wrap gap-2.5">
            {TONES.map((tone) => (
              <button key={tone} onClick={() => toggleTone(tone)} className={`rounded-full border-2 px-3.5 py-2 text-sm font-medium ${p.tones.includes(tone) ? 'border-accent bg-accent-soft text-accent-hover' : 'border-border text-fg'}`}>{tone}</button>
            ))}
          </div>
        </div>

        <label className="mt-5 mb-1.5 block font-semibold text-fg" htmlFor="objective">{t('objective')}</label>
        <input id="objective" className="w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent focus:outline-none" value={p.objective} onChange={(e) => setP({ objective: e.target.value })} />

        <label className="mt-5 mb-1.5 block font-semibold text-fg" htmlFor="info">{t('info')}</label>
        <textarea id="info" className="min-h-[74px] w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent focus:outline-none" value={p.info} onChange={(e) => setP({ info: e.target.value })} />

        <div className="mt-3 rounded-xl border border-dashed border-border">
          <button onClick={() => setAdvanced((a) => !a)} className="flex w-full items-center justify-between bg-bg px-4 py-3 text-left text-sm font-semibold text-fg">
            <span>{advanced ? '▾' : '▸'} {t('advanced')}</span><span className="text-xs font-normal text-muted-2">{t('advancedHint')}</span>
          </button>
          {advanced && (
            <div className="border-t border-dashed border-border p-4">
              <textarea className="min-h-[130px] w-full rounded-lg border border-border bg-surface px-3.5 py-3 font-mono text-xs text-fg focus:border-accent focus:outline-none"
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
          <textarea className="min-h-[60px] w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-fg focus:border-accent focus:outline-none"
            value={state.welcome[lang] ?? ''} onChange={(e) => update({ welcome: { ...state.welcome, [lang]: e.target.value } })} />
        )}

        <div className="my-6 h-px bg-border" />
        <div className="font-semibold text-fg">{t('leadSection')}</div>
        <p className="mb-3 text-sm text-muted">{t('leadHint')}</p>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
          {state.leadFields.map((f) => (
            <span key={f} className="flex items-center gap-1.5 rounded-md bg-[#EAF2EE] px-2.5 py-1 text-sm font-semibold text-brand-deep">
              {f}<button onClick={() => update({ leadFields: state.leadFields.filter((x) => x !== f) })} className="text-muted-2">✕</button>
            </span>
          ))}
          <input className="min-w-[140px] flex-1 bg-transparent px-1.5 py-1 text-sm focus:outline-none" placeholder={t('addField')}
            value={leadInput} onChange={(e) => setLeadInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLead(); } }} />
        </div>

        {error && <p role="alert" className="mt-4 text-sm text-danger">{t('createError')}</p>}

        <div className="mt-7 flex items-center justify-between">
          <button onClick={onBack} className="font-semibold text-muted hover:text-fg">← {t('back')}</button>
          <button onClick={submit} disabled={!canSubmit || busy}
            className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50">
            {busy ? t('creating') : t('createAndTest')} →
          </button>
        </div>
      </div>
    </div>
  );
}
