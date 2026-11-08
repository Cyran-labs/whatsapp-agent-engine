'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useSession } from '@/components/providers/session-provider';

type StepKey = 'created' | 'personalized' | 'connected' | 'active';
const STEPS: { key: StepKey; plan7?: boolean }[] = [
  { key: 'created' }, { key: 'personalized' }, { key: 'connected', plan7: true }, { key: 'active', plan7: true },
];
const LABEL: Record<StepKey, { t: string; d: string }> = {
  created: { t: 'stepCreate', d: 'stepCreateDesc' },
  personalized: { t: 'stepPersonalize', d: 'stepPersonalizeDesc' },
  connected: { t: 'stepConnect', d: 'stepConnectDesc' },
  active: { t: 'stepActivate', d: 'stepActivateDesc' },
};

// first-run : rendu uniquement quand l'utilisateur n'a aucun agent (toutes les etapes sont a faire).
export function FirstRun() {
  const t = useTranslations('onboarding');
  const { isAdmin, readOnly } = useSession();
  const canCreate = isAdmin && !readOnly;
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="font-serif text-3xl text-fg">{t('welcomeTitle')}</h1>
      <p className="mt-2 max-w-lg text-muted">{t('welcomeSubtitle')}</p>

      <div className="mt-8 rounded-xl border border-border bg-surface p-7">
        <div className="font-semibold text-fg">{t('journeyTitle')}</div>
        <ul className="mt-5 divide-y divide-border">
          {STEPS.map(({ key, plan7 }) => {
            const status = plan7 ? 'statusLocked' : 'statusNext';
            return (
              <li key={key} className="flex items-center gap-4 py-3.5">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${plan7 ? 'border-2 border-dashed border-muted-2 text-muted-2' : 'border-2 border-accent-ink bg-accent-soft text-accent-ink'}`}>
                  {STEPS.findIndex((s) => s.key === key) + 1}
                </span>
                <span className="flex-1">
                  <span className="block font-medium text-fg">{t(LABEL[key].t)}</span>
                  <span className="block text-xs text-muted">{t(LABEL[key].d)}</span>
                </span>
                <span className="text-xs font-semibold text-muted-2">{plan7 ? `${t('statusLocked')} · ${t('comingSoon')}` : t(status)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-7 text-center">
        {canCreate ? (
          <Link href="/agents/new" className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 font-semibold text-accent-fg hover:bg-accent-hover">
            <span>{t('createFirst')}</span>
            <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <p className="text-sm text-muted-2">{t('noAgentsNoCreate')}</p>
        )}
      </div>
    </section>
  );
}
