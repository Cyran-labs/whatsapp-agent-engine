import { useTranslations } from 'next-intl';

export type StepIndex = 1 | 2 | 3 | 4 | 5;

export function Stepper({ current }: { current: StepIndex }) {
  const t = useTranslations('wizard');
  const steps = [t('stepIdentity'), t('stepPersonality'), t('stepTest'), t('stepNumber'), t('stepActivate')];
  return (
    <ol className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-y-2 px-5 py-8">
      {steps.map((label, i) => {
        const n = (i + 1) as StepIndex;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} aria-current={active ? 'step' : undefined} className="flex items-center">
            <div className="flex items-center gap-2.5">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${active ? 'bg-accent text-accent-fg' : done ? 'bg-success text-white' : 'border-2 border-border bg-surface text-muted-2'}`}>
                {done ? '✓' : n}
              </span>
              <span className={`text-sm font-semibold ${active || done ? 'text-fg' : 'text-muted-2'}`}>{label}</span>
            </div>
            {i < steps.length - 1 && <span aria-hidden="true" className={`mx-3 h-0.5 w-8 ${done ? 'bg-success' : 'bg-border'}`} />}
          </li>
        );
      })}
    </ol>
  );
}
