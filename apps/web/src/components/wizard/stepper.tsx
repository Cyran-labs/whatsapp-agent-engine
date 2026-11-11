'use client';

import { useTranslations } from 'next-intl';
import { ComingSoon } from '@/components/shell/coming-soon';
import { cn } from '@/lib/utils';

/** Les étapes de l'assistant, dans l'ordre : source unique du stepper et des compteurs « n / total ». */
const STEPS = [
  { label: 'stepIdentity', key: 'identity' },
  { label: 'stepPersonality', key: 'personality' },
  { label: 'stepTest', key: 'test' },
  { label: 'stepNumber', key: 'number' },
  { label: 'stepActivate', key: 'activate' },
] as const;
export const STEP_COUNT = STEPS.length;

export type StepIndex = 1 | 2 | 3 | 4 | 5;

/** Largeur du contenu des étapes, aligné à gauche dans la zone de contenu (maquette assistant-rail : 640 px). */
export const WIZARD_PANE = 'w-full max-w-[640px]';

/** Compteur « 3 / 5 » en tête d'une étape. */
export function StepCounter({ step }: { step: StepIndex }) {
  return <div className="text-xs font-semibold uppercase tracking-wider text-accent-ink">{step} / {STEP_COUNT}</div>;
}

type Phase = 'current' | 'done' | 'resume' | 'later' | 'finished';

const ROW = 'relative flex w-full gap-[11px] rounded-lg px-2.5 py-2 text-left';
const CIRCLE: Record<Phase, string> = {
  current: 'border-accent bg-accent text-accent-fg',
  done: 'border-success bg-success text-white',
  resume: 'border-accent-ink bg-surface text-accent-ink',
  later: 'border-border bg-surface text-muted-2',
  finished: 'border-success bg-success text-white',
};

/**
 * Stepper vertical de la colonne du milieu (spec 12.1, maquette assistant-rail) : cinq étapes avec leur ligne de
 * description. Une étape atteinte est un bouton qui y mène ; une étape à venir est grisée, non cliquable, et dit au
 * survol et au focus ce qui la débloque. L'assistant terminé (`success`), plus rien n'est cliquable.
 */
export function Stepper({ current, furthest, onGo }: { current: StepIndex | 'success'; furthest: StepIndex; onGo: (step: StepIndex) => void }) {
  const t = useTranslations('wizard');
  const finished = current === 'success';
  return (
    <ol aria-label={t('column.stepsLabel')} className="space-y-1.5">
      {STEPS.map((step, i) => {
        const n = (i + 1) as StepIndex;
        const phase: Phase = finished
          ? n <= furthest ? 'finished' : 'later'
          : n === current ? 'current' : n < furthest ? 'done' : n === furthest ? 'resume' : 'later';
        const checked = phase === 'done' || phase === 'finished';
        const state = finished ? null : phase === 'current' ? t('stepState.current') : phase === 'done' ? t('stepDone') : phase === 'resume' ? t('stepState.resume') : t('stepState.later');
        const content = (
          <>
            <span aria-hidden="true" className={cn('relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold', CIRCLE[phase])}>
              {checked ? '✓' : n}
            </span>
            <span className="min-w-0">
              <span className={cn('block pt-[3px] text-[13.5px] font-semibold leading-tight', phase === 'later' ? 'text-muted-2' : 'text-fg')}>
                {t(step.label)}
                {state && <span className="sr-only"> ({state})</span>}
              </span>
              <span className="mt-0.5 block text-[11.5px] text-muted-2">{t(`stepHints.${step.key}`)}</span>
            </span>
          </>
        );
        const tooltip = finished ? t('laterReason.finished') : phase === 'later' && step.key !== 'identity' ? t(`laterReason.${step.key}`) : null;
        return (
          <li key={step.key} aria-current={phase === 'current' ? 'step' : undefined} className="relative">
            {i < STEPS.length - 1 && (
              <span aria-hidden="true" className={cn('absolute left-[21px] top-9 h-[calc(100%-26px)] w-0.5', checked ? 'bg-success' : 'bg-border')} />
            )}
            {phase === 'current' && <div className={cn(ROW, 'bg-surface-subtle shadow-[inset_0_0_0_1px_var(--border)]')}>{content}</div>}
            {(phase === 'done' || phase === 'resume') && (
              <button type="button" onClick={() => onGo(n)} className={cn(ROW, 'hover:bg-surface-subtle')}>
                {content}
              </button>
            )}
            {tooltip !== null && (
              <ComingSoon tooltip={tooltip} className={ROW}>
                {content}
              </ComingSoon>
            )}
          </li>
        );
      })}
    </ol>
  );
}
