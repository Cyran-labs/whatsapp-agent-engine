'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AppFrame } from '@/components/shell/app-frame';
import { useNavigationGuard } from '@/components/shell/navigation-guard';
import { PageBar } from '@/components/shell/page-bar';
import { InlineError } from '@/components/feedback/inline-error';
import { useMutate } from '@/components/feedback/use-mutate';
import type { StepIndex } from './stepper';
import { WizardColumn } from './wizard-column';
import { StepIdentity } from './step-identity';
import { StepPersonality } from './step-personality';
import { StepTest } from './step-test';
import { StepNumber } from './step-number';
import { StepActivate, type Activated } from './step-activate';
import { Success } from './success';
import { BOT_REFUSAL_FIELDS, IDENTITY_FIELDS, buildBotPayload, leadFieldProblem, type IdentityErrors, type WizardState } from '@/lib/bot-draft';
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
  // Configuration telle que le moteur l'a, relevée à chaque création ou renvoi réussi : l'encadré et l'écran de fin
  // disent ce qui est enregistré, pas ce qui est affiché (relecture tâche 13, I-1).
  const [saved, setSaved] = useState<WizardState | null>(null);
  // Saisies hors de l'état de l'assistant que la sortie perdrait aussi (relecture tâche 13, M-1) : champ de lead tapé
  // sans « Ajouter » (étape 2), numéro de Whitelist tapé sans « Ajouter » (étape 5).
  const [leadDraft, setLeadDraft] = useState('');
  const [allowlistDraft, setAllowlistDraft] = useState('');
  // Renvoi des modifications avant un saut du stepper : refus sans emplacement propre, refus de la personnalité.
  const [saveFailure, setSaveFailure] = useState<{ message: string; reference: string | null } | null>(null);
  const [personalityRefusal, setPersonalityRefusal] = useState(0);
  // Verrou d'envoi unique, partagé par « Créer et tester » et le renvoi avant un saut du stepper (re-relecture N-3).
  const sendLock = useRef(false);
  const mutate = useMutate('Wizard');
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
    setSaveFailure(null);
    setStepState(next);
    if (next !== 'success') setFurthest((f) => (next > f ? next : f));
  }, []);

  // État affiché le plus récent, lu à la réponse d'un envoi (une frappe a pu arriver pendant la requête).
  const stateRef = useRef(state);
  stateRef.current = state;

  // Une saisie serait perdue (spec 12.4) : modification non envoyée, ou texte tapé sans « Ajouter ». À la fin, plus rien.
  const pendingInput =
    step !== 'success' && (unsaved || leadDraft.trim() !== '' || allowlist.length > 0 || allowlistDraft.trim() !== '');
  const { setGuard, confirmLeave } = useNavigationGuard();
  useEffect(() => {
    setGuard(pendingInput);
  }, [pendingInput, setGuard]);
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
    setSaveFailure(null);
    if (patch.perLang !== undefined) setPersonalityRefusal(0);
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

  /**
   * Enregistrement réussi de `sent` (ce qui est parti, pas l'état à la réponse) : c'est ce que le moteur a. `current` est
   * l'état affiché à la réponse ; s'il diffère de ce qui est parti (frappe pendant la requête), la modification reste en
   * attente et gardée (re-relecture tâche 13, N-2).
   */
  const markSaved = (sent: WizardState, current: WizardState) => {
    setSaved(sent);
    setPersonalityRefusal(0);
    if (JSON.stringify(buildBotPayload(current)) === JSON.stringify(buildBotPayload(sent))) setUnsaved(false);
  };

  /**
   * Renvoie les modifications en attente, comme « Créer et tester » à l'étape 2 (même PATCH, mêmes emplacements de
   * refus) : un saut du stepper vers les étapes 3 à 5 ne laisse rien derrière lui (relecture tâche 13, I-1). `false` :
   * l'envoi n'a pas abouti, l'assistant reste où il est (ou va à l'étape qui porte le refus).
   */
  const saveChanges = async (): Promise<boolean> => {
    if (createdBotId === null) return false;
    if (leadFieldProblem(leadDraft, state.leadFields) !== null) {
      setSaveFailure({ message: t('leadDuplicate'), reference: null });
      return false;
    }
    const pendingLead = leadDraft.trim();
    const draft: WizardState = pendingLead ? { ...state, leadFields: [...state.leadFields, pendingLead] } : state;
    const outcome = await mutate(`/api/bots/${encodeURIComponent(createdBotId)}`, 'PATCH', buildBotPayload(draft), BOT_REFUSAL_FIELDS);
    // Organisation changée dans un autre onglet : la page se recharge, rien à afficher.
    if (outcome.status === 'changed') return false;
    if (outcome.status === 'ok') {
      // Le champ de lead tapé est parti : il rejoint la liste affichée, comme avec « Créer et tester ».
      const current = stateRef.current;
      const shownAfter = pendingLead ? { ...current, leadFields: [...current.leadFields, pendingLead] } : current;
      if (pendingLead) {
        setState((s) => ({ ...s, leadFields: [...s.leadFields, pendingLead] }));
        setLeadDraft('');
      }
      markSaved(draft, shownAfter);
      return true;
    }
    const { failure } = outcome;
    const identity: IdentityErrors = Object.fromEntries(
      IDENTITY_FIELDS.flatMap((field) => (failure.fieldErrors[field] !== undefined ? [[field, failure.fieldErrors[field]]] : [])),
    );
    if (Object.keys(identity).length > 0) refuseIdentity(identity);
    else if (failure.fieldErrors.system_prompt !== undefined) {
      setStep(2);
      setPersonalityRefusal((n) => n + 1);
    } else setSaveFailure({ message: failure.message, reference: failure.reference });
    return false;
  };

  /** Saut du stepper : vers une étape suivante après la création, les modifications en attente partent d'abord. */
  const go = async (target: StepIndex) => {
    const pending = unsaved || leadDraft.trim() !== '';
    if (target <= 2 || createdBotId === null || !pending) {
      setStep(target);
      return;
    }
    if (sendLock.current) return;
    sendLock.current = true;
    try {
      if (await saveChanges()) setStep(target);
    } finally {
      sendLock.current = false;
    }
  };

  const created = createdBotId !== null;
  const shown = saved ?? state;
  // Le choix du numéro conditionne l'étape 5 : oublié (numéro retiré), elle n'est plus atteignable. À la fin, l'étape 5
  // n'est faite que si l'agent IA a été activé (« Laisser en Draft » la quitte sans la faire).
  const reachable: StepIndex = (numberId === null || (step === 'success' && activated === null)) && furthest === 5 ? 4 : furthest;
  const quitHint = step === 'success' ? t('bar.hintEnd') : created ? t('bar.hintDraft') : t('bar.hintNothing');

  return (
    <AppFrame
      space="agents"
      column={
        <WizardColumn
          step={step}
          furthest={reachable}
          created={created}
          // Seules les modifications que « Créer et tester » renvoie ; la Whitelist part à l'activation (re-relecture N-1).
          pending={created && step !== 'success' && (unsaved || leadDraft.trim() !== '')}
          activated={activated}
          name={shown.name}
          onGo={(target) => void go(target)}
        />
      }
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
      {saveFailure && (
        <div className="mb-4 max-w-[640px]">
          <InlineError message={saveFailure.message} reference={saveFailure.reference} />
        </div>
      )}

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
          onCreated={(id, entityId, sent) => { setCreatedBotId(id); setCreatedEntityId(entityId); markSaved(sent, stateRef.current); setStep(3); }}
          onIdentityRefused={refuseIdentity}
          personalityRefusal={personalityRefusal}
          onLeadDraftChange={setLeadDraft}
          sendLock={sendLock}
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
          onDraftChange={setAllowlistDraft}
          entityId={createdEntityId}
          entities={entities}
          onBack={() => setStep(4)}
          onLater={() => setStep('success')}
          onActivated={(result) => { setActivated(result); setStep('success'); }}
        />
      )}
      {step === 'success' && createdBotId && (
        <Success state={shown} botId={createdBotId} activated={activated} onHome={quit} />
      )}
      </div>
    </AppFrame>
  );
}
