import { useTranslations } from 'next-intl';

export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const t = useTranslations('wizard');
  const steps = [t('stepIdentity'), t('stepPersonality'), t('stepTest')];
  return (
    <div className="mx-auto flex max-w-xl items-center justify-center py-8">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < current;
        const active = n === current;
        return (
          <div key={label} className="flex items-center">
            <div className="flex items-center gap-2.5">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${active ? 'bg-accent text-accent-fg' : done ? 'bg-success text-white' : 'border-2 border-border bg-surface text-muted-2'}`}>
                {done ? '✓' : n}
              </span>
              <span className={`text-sm font-semibold ${active || done ? 'text-fg' : 'text-muted-2'}`}>{label}</span>
            </div>
            {i < steps.length - 1 && <span className={`mx-3.5 h-0.5 w-14 ${done ? 'bg-success' : 'bg-border'}`} />}
          </div>
        );
      })}
    </div>
  );
}
