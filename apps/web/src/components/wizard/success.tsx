'use client';

import { useTranslations } from 'next-intl';
import type { WizardState } from '@/lib/bot-draft';

const LANG_LABEL: Record<string, string> = { fr: 'Français', en: 'English' };
interface Props { state: WizardState; onHome: () => void; onEdit: () => void }

export function Success({ state, onHome, onEdit }: Props) {
  const t = useTranslations('success');
  return (
    <div className="mx-auto max-w-lg px-5 py-12 text-center">
      <div className="mx-auto mb-5 flex h-[74px] w-[74px] items-center justify-center rounded-full bg-[#E7F6EF] text-4xl text-success">✓</div>
      <h1 className="font-serif text-3xl text-fg">{t('title')}</h1>
      <p className="mx-auto mt-2 mb-7 max-w-md text-muted">{t('subtitle', { name: state.name })}</p>

      <div className="rounded-xl border border-border bg-surface p-5 text-left">
        <div className="flex justify-between py-2"><span className="text-muted">{t('agent')}</span><span className="font-semibold text-fg">{state.name}</span></div>
        <div className="flex justify-between border-t border-border py-2"><span className="text-muted">{t('languages')}</span><span className="font-semibold text-fg">{state.languages.map((l) => LANG_LABEL[l]).join(' · ')}</span></div>
        <div className="flex justify-between border-t border-border py-2"><span className="text-muted">{t('status')}</span><span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent-hover">● {t('draft')}</span></div>
      </div>

      <div className="mt-6 flex items-center gap-3.5 rounded-xl border border-border bg-surface p-4 text-left opacity-75">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg text-lg">🔗</span>
        <span className="flex-1"><span className="block font-semibold text-fg">{t('connectTitle')}</span><span className="block text-xs text-muted">{t('connectDesc')}</span></span>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold text-muted-2">{t('comingSoon')}</span>
      </div>

      <div className="mt-7 flex justify-center gap-3">
        <button onClick={onHome} className="rounded-xl border border-border bg-surface px-5 py-3 font-semibold text-fg">{t('backToAgents')}</button>
        <button onClick={onEdit} className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg hover:bg-accent-hover">{t('editPersonality')}</button>
      </div>
    </div>
  );
}
