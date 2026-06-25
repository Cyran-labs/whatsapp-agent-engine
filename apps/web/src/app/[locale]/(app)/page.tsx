'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { deriveChecklist, type BotSummary, type ChecklistState } from '@/lib/onboarding';

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

export default function Home() {
  const t = useTranslations('onboarding');
  const [bots, setBots] = useState<BotSummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/bots').then((r) => (r.ok ? r.json() : [])).then((b) => { if (alive) setBots(b as BotSummary[]); }).catch(() => { if (alive) setBots([]); });
    return () => { alive = false; };
  }, []);

  const checklist: ChecklistState = deriveChecklist(bots ?? []);
  const hasBots = (bots?.length ?? 0) > 0;

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="font-serif text-3xl text-fg">{t('welcomeTitle')}</h1>
      <p className="mt-2 max-w-lg text-muted">{t('welcomeSubtitle')}</p>

      <div className="mt-8 rounded-xl border border-border bg-surface p-7">
        <div className="font-semibold text-fg">{t('journeyTitle')}</div>
        {hasBots && <div className="mt-1 text-sm text-muted">{t('agentsCount', { count: bots!.length })}</div>}
        <ul className="mt-5 divide-y divide-border">
          {STEPS.map(({ key, plan7 }) => {
            const done = checklist[key];
            const status = done ? 'statusDone' : plan7 ? 'statusLocked' : 'statusNext';
            return (
              <li key={key} className="flex items-center gap-4 py-3.5">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-success text-white' : plan7 ? 'border-2 border-dashed border-muted-2 text-muted-2' : 'border-2 border-accent bg-accent-soft text-accent-hover'}`}>
                  {done ? '✓' : STEPS.findIndex((s) => s.key === key) + 1}
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
        <Link href="/agents/new" className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 font-semibold text-accent-fg hover:bg-accent-hover">
          <span>{hasBots ? t('createAnother') : t('createFirst')}</span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
