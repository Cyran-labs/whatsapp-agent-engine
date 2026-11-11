'use client';

import { useTranslations } from 'next-intl';
import type { WizardState } from '@/lib/bot-draft';
import { SimulateChat } from '@/components/agent/simulate-chat';
import { StepCounter, WIZARD_PANE } from './stepper';

interface Props { botId: string; state: WizardState; onNext: () => void; onBack: () => void }

export function StepTest({ botId, state, onNext, onBack }: Props) {
  const t = useTranslations('simulate');
  const welcome = state.welcomeEnabled ? state.welcome[state.defaultLanguage]?.trim() : undefined;

  return (
    <div className={`${WIZARD_PANE} pb-12`}>
      <StepCounter step={3} />
      <h1 className="mt-1.5 font-serif text-2xl text-fg">{t('title')}</h1>
      <p className="mt-1.5 mb-4 text-muted">{t('lead')}</p>

      <div className="mb-4 rounded-lg border border-border-strong bg-surface-subtle px-3 py-2.5 text-center text-xs font-medium text-brand-deep">⚡ {t('freeBadge')}</div>

      <SimulateChat botId={botId} agentName={state.name} welcome={welcome} />

      <div className="mt-6 flex items-center justify-between">
        <button onClick={onBack} className="font-semibold text-muted hover:text-fg">← {t('back')}</button>
        <button onClick={onNext} className="rounded-xl bg-accent px-6 py-3 font-semibold text-accent-fg hover:bg-accent-hover">{t('next')}</button>
      </div>
    </div>
  );
}
