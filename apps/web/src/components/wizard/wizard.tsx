'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AppFrame } from '@/components/shell/app-frame';
import { useNavigationGuard } from '@/components/shell/navigation-guard';
import { PageBar } from '@/components/shell/page-bar';
import type { StepIndex } from './stepper';
import { WizardColumn } from './wizard-column';
import { StepIdentity } from './step-identity';
import { StepPersonality } from './step-personality';
import { StepTest } from './step-test';
import { StepNumber } from './step-number';
import { StepActivate, type Activated } from './step-activate';
import { Success } from './success';
import type { IdentityErrors, WizardState } from '@/lib/bot-draft';
import { activeEntities, type EntitySummary } from '@/lib/entities';
import { apiFetch } from '@/lib/api-fetch';
import { errorText } from '@/lib/error-text';

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
  const [step, setStepState] = useState<StepIndex | 'success'>(1);
  // Étape la plus avancée atteinte : elle et les précédentes sont cliquables dans le stepper.
  const [furthest, setFurthest] = useState<StepIndex>(1);
  // Saisie que la sortie perdrait (spec 12.4) : avant la création, tout ce que l'utilisateur a modifié ; après, une
  // modification pas encore renvoyée par « Créer et tester » (PATCH de l'étape 2).
  const [unsaved, setUnsaved] = useState(false);
  const [createdBotId, setCreatedBotId] = useState<string | null>(null);
  // Entité enregistrée par le moteur pour l'agent IA (il l'attribue seul quand l'organisation n'en a qu'une).
  const [createdEntityId, setCreatedEntityId] = useState<number | null>(null);
  // Numéro retenu à l'étape 4 : rien n'est branché avant l'activation (étape 5).
  const [numberId, setNumberId] = useState<number | null>(null);
  // Whitelist saisie à l'étape 5 : tenue ici pour survivre à « Changer de numéro ».
  const [allowlist, setAllowlist] = useState<string[]>([]);
  // Renseigné par l'activation réussie : l'écran de fin devient la confirmation (sinon : agent IA resté en Draft).
  const [activated, setActivated] = useState<Activated | null>(null);

  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(true);
  // Liste illisible (audit R-18) : l'étape 1 le dit et reste bloquée, car le champ Entité ne peut pas être décidé.
  const [entitiesFailed, setEntitiesFailed] = useState(false);
  const [entitiesAttempt, setEntitiesAttempt] = useState(0);
  // Refus d'un champ de l'étape 1 par le moteur à la création (audit R-2) : montré à l'étape 1, sous le champ.
  const [identityErrors, setIdentityErrors] = useState<IdentityErrors>({});
  // Compte les refus : l'étape 1 donne le focus au premier champ en erreur à chacun.
  const [refusalCount, setRefusalCount] = useState(0);

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
        setEntitiesFailed(false);
        // Un choix qui n'est plus une entité active est retiré ; la présélection de l'URL ne remplace jamais un choix.
        setState((s) => {
          if (s.entityId !== null) return active.some((e) => e.id === s.entityId) ? s : { ...s, entityId: null };
          return initialEntityId !== null && active.some((e) => e.id === initialEntityId) ? { ...s, entityId: initialEntityId } : s;
        });
      })
      .catch((err: unknown) => {
        console.error('[Wizard] chargement des entités impossible', errorText(err));
        if (alive) setEntitiesFailed(true);
      })
      .finally(() => { if (alive) setEntitiesLoading(false); });
    return () => { alive = false; };
  }, [initialEntityId, entitiesAttempt]);

  const reloadEntities = () => {
    setEntitiesFailed(false);
    setEntitiesLoading(true);
    setEntitiesAttempt((n) => n + 1);
  };

  const setStep = useCallback((next: StepIndex | 'success') => {
    setStepState(next);
    if (next !== 'success') setFurthest((f) => (next > f ? next : f));
  }, []);

  const { setGuard, confirmLeave } = useNavigationGuard();
  useEffect(() => {
    setGuard(unsaved);
  }, [unsaved, setGuard]);
  // La page quittée (navigation confirmée ou fin) ne garde plus rien.
  useEffect(() => () => setGuard(false), [setGuard]);

  const quit = () => {
    void confirmLeave().then((ok) => {
      if (ok) router.push('/');
    });
  };

  // Modifier un champ efface son erreur.
  const update = (patch: Partial<WizardState>) => {
    setUnsaved(true);
    const edited: IdentityErrors = {};
    if (patch.name !== undefined) edited.name = '';
    if (patch.slug !== undefined) edited.bot_id = '';
    if (patch.entityId !== undefined) edited.entity_id = '';
    if (patch.languages !== undefined) edited.languages = '';
    if (patch.defaultLanguage !== undefined) edited.default_language = '';
    if (Object.keys(edited).length > 0) {
      setIdentityErrors((errors) => Object.fromEntries(Object.entries(errors).filter(([field]) => !(field in edited))));
    }
    setState((s) => ({ ...s, ...patch }));
  };

  // Le moteur a refusé un champ de l'étape 1 : retour à l'étape qui le porte ; pour l'entité, liste relue (une entité a pu être archivée).
  const refuseIdentity = (errors: IdentityErrors) => {
    setIdentityErrors(errors);
    setRefusalCount((n) => n + 1);
    setStep(1);
    if (errors.entity_id !== undefined) reloadEntities();
  };

  const created = createdBotId !== null;
  // Le choix du numéro conditionne l'étape 5 : oublié (numéro retiré), elle n'est plus atteignable. À la fin, l'étape 5
  // n'est faite que si l'agent IA a été activé (« Laisser en Draft » la quitte sans la faire).
  const reachable: StepIndex = (numberId === null || (step === 'success' && activated === null)) && furthest === 5 ? 4 : furthest;
  const quitHint = step === 'success' ? t('bar.hintEnd') : created ? t('bar.hintDraft') : t('bar.hintNothing');

  return (
    <AppFrame
      space="agents"
      column={<WizardColumn step={step} furthest={reachable} created={created} activated={activated} name={state.name} onGo={setStep} />}
    >
      <PageBar
        trail={[{ label: t('bar.agents'), href: '/' }, { label: t('bar.create') }]}
        action={
          <>
            <span className="text-xs text-muted-2">{quitHint}</span>
            <button type="button" onClick={quit} className="rounded-lg border border-border-strong bg-surface px-3.5 py-2 text-[13px] font-semibold text-fg hover:bg-surface-subtle">
              <span aria-hidden="true">✕ </span>
              {t('quit')}
            </button>
          </>
        }
      />
      <div className="px-[30px] pb-10 pt-[26px]">

      {step === 1 && (
        <StepIdentity
          state={state}
          update={update}
          entities={entities}
          entitiesLoading={entitiesLoading}
          entitiesFailed={entitiesFailed}
          onRetryEntities={reloadEntities}
          errors={identityErrors}
          focusRequest={refusalCount}
          onNext={() => setStep(2)}
          onBack={quit}
        />
      )}
      {step === 2 && (
        <StepPersonality
          state={state}
          update={update}
          createdBotId={createdBotId}
          onCreated={(id, entityId) => { setCreatedBotId(id); setCreatedEntityId(entityId); setUnsaved(false); setStep(3); }}
          onIdentityRefused={refuseIdentity}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && createdBotId && <StepTest botId={createdBotId} state={state} onNext={() => setStep(4)} onBack={() => setStep(2)} />}
      {step === 4 && createdBotId && (
        <StepNumber
          botId={createdBotId}
          numberId={numberId}
          onChange={setNumberId}
          onBack={() => setStep(3)}
          onNext={() => setStep(5)}
          onLater={() => setStep('success')}
        />
      )}
      {step === 5 && createdBotId && numberId !== null && (
        <StepActivate
          botId={createdBotId}
          numberId={numberId}
          state={state}
          entries={allowlist}
          onEntriesChange={setAllowlist}
          entityId={createdEntityId}
          entities={entities}
          onBack={() => setStep(4)}
          onLater={() => setStep('success')}
          onActivated={(result) => { setActivated(result); setStep('success'); }}
        />
      )}
      {step === 'success' && createdBotId && (
        <Success state={state} botId={createdBotId} activated={activated} onHome={() => router.push('/')} />
      )}
      </div>
    </AppFrame>
  );
}
