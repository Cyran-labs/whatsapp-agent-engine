'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Stepper } from './stepper';
import { StepIdentity } from './step-identity';
import { StepPersonality } from './step-personality';
import { StepTest } from './step-test';
import { Success } from './success';
import type { WizardState } from '@/lib/bot-draft';
import { activeEntities, type EntitySummary } from '@/lib/entities';
import { apiFetch } from '@/lib/api-fetch';

const initialState: WizardState = {
  name: '', slug: '', languages: ['fr'], defaultLanguage: 'fr',
  perLang: { fr: { mode: 'guided', role: '', tones: [], objective: '', info: '', raw: '' } },
  welcomeEnabled: true, welcome: {}, leadFields: [], entityId: null,
};

interface WizardProps {
  /** Entité à présélectionner (paramètre d'URL `?entity=`), ignorée si ce n'est pas une entité active. */
  initialEntityId?: number | null;
}

export function Wizard({ initialEntityId = null }: WizardProps) {
  const t = useTranslations('wizard');
  const router = useRouter();
  const [state, setState] = useState<WizardState>(initialState);
  const [step, setStep] = useState<1 | 2 | 3 | 'success'>(1);
  const [createdBotId, setCreatedBotId] = useState<string | null>(null);

  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/entities')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<EntitySummary[]>;
      })
      .then((list) => {
        if (!alive) return;
        const active = activeEntities(list);
        setEntities(active);
        if (initialEntityId !== null && active.some((e) => e.id === initialEntityId)) {
          setState((s) => ({ ...s, entityId: initialEntityId }));
        }
      })
      .catch((err: unknown) => {
        // Champ masqué : le moteur répondra (et son erreur s'affichera) si l'entité était requise.
        console.error('[Wizard] chargement des entités impossible', err);
      })
      .finally(() => { if (alive) setEntitiesLoading(false); });
    return () => { alive = false; };
  }, [initialEntityId]);

  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));

  return (
    <div className="min-h-screen bg-bg">
      <div className="flex h-14 items-center justify-between border-b border-border bg-surface px-5">
        <span className="font-semibold tracking-wide text-fg">WABAGENT</span>
        <button onClick={() => router.push('/')} className="font-medium text-muted hover:text-fg">✕ {t('quit')}</button>
      </div>

      {step !== 'success' && <Stepper current={step} />}

      {step === 1 && <StepIdentity state={state} update={update} entities={entities} entitiesLoading={entitiesLoading} onNext={() => setStep(2)} onBack={() => router.push('/')} />}
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
