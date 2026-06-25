'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Stepper } from './stepper';
import { StepIdentity } from './step-identity';
import { StepPersonality } from './step-personality';
import { StepTest } from './step-test';
import { Success } from './success';
import type { WizardState } from '@/lib/bot-draft';

const initialState: WizardState = {
  name: '', slug: '', languages: ['fr'], defaultLanguage: 'fr',
  perLang: { fr: { mode: 'guided', role: '', tones: [], objective: '', info: '', raw: '' } },
  welcomeEnabled: true, welcome: {}, leadFields: [],
};

export function Wizard() {
  const t = useTranslations('wizard');
  const router = useRouter();
  const [state, setState] = useState<WizardState>(initialState);
  const [step, setStep] = useState<1 | 2 | 3 | 'success'>(1);
  const [createdBotId, setCreatedBotId] = useState<string | null>(null);

  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));

  return (
    <div className="min-h-screen bg-bg">
      <div className="flex h-14 items-center justify-between border-b border-border bg-surface px-5">
        <span className="font-semibold tracking-wide text-fg">WABAGENT</span>
        <button onClick={() => router.push('/')} className="font-medium text-muted hover:text-fg">✕ {t('quit')}</button>
      </div>

      {step !== 'success' && <Stepper current={step} />}

      {step === 1 && <StepIdentity state={state} update={update} onNext={() => setStep(2)} onBack={() => router.push('/')} />}
      {step === 2 && (
        <StepPersonality
          state={state}
          update={update}
          createdBotId={createdBotId}
          onCreated={(id) => { setCreatedBotId(id); setStep(3); }}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && createdBotId && <StepTest botId={createdBotId} state={state} onFinish={() => setStep('success')} onBack={() => setStep(2)} />}
      {step === 'success' && <Success state={state} onHome={() => router.push('/')} onEdit={() => setStep(2)} />}
    </div>
  );
}
