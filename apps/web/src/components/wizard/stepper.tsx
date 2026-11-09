import { useTranslations } from 'next-intl';

/** Les étapes de l'assistant, dans l'ordre : source unique du stepper et des compteurs « n / total ». */
const STEP_KEYS = ['stepIdentity', 'stepPersonality', 'stepTest', 'stepNumber', 'stepActivate'] as const;
export const STEP_COUNT = STEP_KEYS.length;

export type StepIndex = 1 | 2 | 3 | 4 | 5;

/** Largeur unique du contenu des cinq étapes (maquette 2 : 560 px, gouttières comprises). */
export const WIZARD_PANE = 'mx-auto w-full max-w-[560px] px-5';

/** Compteur « 3 / 5 » en tête d'une étape. */
export function StepCounter({ step, centered = false }: { step: StepIndex; centered?: boolean }) {
  return <div className={`${centered ? 'text-center ' : ''}text-xs font-semibold uppercase tracking-wider text-accent-ink`}>{step} / {STEP_COUNT}</div>;
}

/**
 * Les cinq étapes tiennent sur une ligne dès 1024 px (maquette 2 : pastilles de 24 px, connecteurs de 30 px).
 * Sous 768 px, seul le libellé de l'étape courante reste visible (les autres sont lus aux lecteurs d'écran).
 */
export function Stepper({ current }: { current: StepIndex }) {
  const t = useTranslations('wizard');
  return (
    <ol className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-y-2 px-5 py-6">
      {STEP_KEYS.map((key, i) => {
        const label = t(key);
        const n = (i + 1) as StepIndex;
        const done = n < current;
        const active = n === current;
        return (
          <li key={key} aria-current={active ? 'step' : undefined} className="flex items-center">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${active ? 'bg-accent text-accent-fg' : done ? 'bg-success text-white' : 'border-2 border-border bg-surface text-muted-2'}`}>
                {done ? '✓' : n}
              </span>
              <span className={`whitespace-nowrap text-[12.5px] font-semibold ${active || done ? 'text-fg' : 'text-muted-2'} ${active ? '' : 'sr-only md:not-sr-only'}`}>
                {label}
                {done && <span className="sr-only"> ({t('stepDone')})</span>}
              </span>
            </div>
            {i < STEP_KEYS.length - 1 && <span aria-hidden="true" className={`mx-1.5 h-0.5 w-4 md:mx-[9px] md:w-[30px] ${done ? 'bg-success' : 'bg-border'}`} />}
          </li>
        );
      })}
    </ol>
  );
}
