import { useTranslations } from 'next-intl';

/** Les étapes de l'assistant, dans l'ordre : source unique du stepper et des compteurs « n / total ». */
const STEP_KEYS = ['stepIdentity', 'stepPersonality', 'stepTest', 'stepNumber', 'stepActivate'] as const;
export const STEP_COUNT = STEP_KEYS.length;

export type StepIndex = 1 | 2 | 3 | 4 | 5;

/** Compteur « 3 / 5 » en tête d'une étape. */
export function StepCounter({ step, centered = false }: { step: StepIndex; centered?: boolean }) {
  return <div className={`${centered ? 'text-center ' : ''}text-xs font-semibold uppercase tracking-wider text-accent-ink`}>{step} / {STEP_COUNT}</div>;
}

export function Stepper({ current }: { current: StepIndex }) {
  const t = useTranslations('wizard');
  return (
    <ol className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-y-2 px-5 py-8">
      {STEP_KEYS.map((key, i) => {
        const label = t(key);
        const n = (i + 1) as StepIndex;
        const done = n < current;
        const active = n === current;
        return (
          <li key={key} aria-current={active ? 'step' : undefined} className="flex items-center">
            <div className="flex items-center gap-2.5">
              <span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${active ? 'bg-accent text-accent-fg' : done ? 'bg-success text-white' : 'border-2 border-border bg-surface text-muted-2'}`}>
                {done ? '✓' : n}
              </span>
              <span className={`text-sm font-semibold ${active || done ? 'text-fg' : 'text-muted-2'}`}>
                {label}
                {done && <span className="sr-only"> ({t('stepDone')})</span>}
              </span>
            </div>
            {i < STEP_KEYS.length - 1 && <span aria-hidden="true" className={`mx-3 h-0.5 w-8 ${done ? 'bg-success' : 'bg-border'}`} />}
          </li>
        );
      })}
    </ol>
  );
}
