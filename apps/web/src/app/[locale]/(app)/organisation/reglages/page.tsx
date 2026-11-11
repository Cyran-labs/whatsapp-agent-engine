'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { OrganizationSettings } from '@wabagent/contracts';
import { useSession } from '@/components/providers/session-provider';
import { HintBubble, SoonBadge, useHint } from '@/components/shell/coming-soon';
import { PageBar } from '@/components/shell/page-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadError } from '@/components/feedback/load-error';
import { apiFetch, isOrgChanged } from '@/lib/api-fetch';
import { errorText } from '@/lib/error-text';
import { cn } from '@/lib/utils';

type Visibility = OrganizationSettings['visibility'];

const MODES: { value: Visibility; available: boolean }[] = [
  { value: 'all', available: true },
  { value: 'entities', available: false },
  { value: 'own_and_pool', available: false },
];

/**
 * Carte d'un mode de visibilité. Un mode indisponible (spec 5.4) est grisé, porte la pastille « Soon » et sa bulle
 * « Disponible prochainement : … » au survol et au focus : il est focalisable pour que le clavier la lise.
 */
function ModeCard({ value, available, checked }: { value: Visibility; available: boolean; checked: boolean }) {
  const t = useTranslations('organisation.settings');
  const hint = useHint();
  const titleId = `visibility-${value}`;
  return (
    <div className="relative">
      <div
        role="radio"
        aria-checked={checked}
        aria-disabled={available ? undefined : true}
        aria-labelledby={titleId}
        // Arrêts du clavier : le mode en vigueur (sa valeur se lit au focus) et chaque mode à venir (sa bulle).
        {...(available ? (checked ? { tabIndex: 0 } : {}) : { tabIndex: 0, ...hint.triggerProps })}
        className={cn(
          'mb-2 flex items-start gap-3 rounded-lg border-[1.5px] px-3.5 py-3 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink',
          checked ? 'border-accent-ink bg-accent-soft text-muted' : 'border-border text-muted-2',
          !available && 'cursor-not-allowed border-dashed bg-surface-subtle',
        )}
      >
        <span
          className={cn(
            'mt-0.5 h-4 w-4 flex-shrink-0 rounded-full bg-surface',
            checked ? 'border-[5px] border-accent-ink' : 'border-[1.5px] border-border-strong',
          )}
          aria-hidden="true"
        />
        <div>
          <b id={titleId} className={cn('mb-px block text-[13.5px] font-semibold', available ? 'text-fg' : 'text-muted')}>
            {t(`modes.${value}.title`)}
          </b>
          {t(`modes.${value}.description`)}
        </div>
        {!available && <SoonBadge className="ml-auto self-center" />}
      </div>
      {!available && <HintBubble id={hint.id} open={hint.open} text={t('modeSoon')} anchor={hint.anchorRef} />}
    </div>
  );
}

export default function ReglagesPage() {
  const t = useTranslations('organisation.settings');
  const tNav = useTranslations('nav');
  const { activeOrg } = useSession();
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/settings')
      .then(async (r) => {
        if (await isOrgChanged(r)) return null;
        return r.ok ? ((await r.json()) as Pick<OrganizationSettings, 'visibility'>) : Promise.reject(new Error(`HTTP ${r.status}`));
      })
      .then((d) => { if (alive && d) setVisibility(d.visibility); })
      .catch((err: unknown) => {
        console.error('[Settings] lecture impossible', errorText(err));
        if (alive) setFailed(true);
      });
    return () => { alive = false; };
  }, [attempt]);

  function retry() {
    setFailed(false);
    setAttempt((n) => n + 1);
  }

  return (
    <>
      <PageBar trail={[{ label: tNav('organisation'), href: '/organisation' }, { label: t('title') }]} />
      <div className="px-8 py-7">
        <div>
          <h1 className="font-serif text-[26px] font-normal leading-[1.1] text-fg">{t('title')}</h1>
          <p className="mt-[5px] max-w-[600px] text-[12.5px] text-muted-2">
            {t('subtitle', { name: activeOrg?.name ?? '' })}
          </p>
        </div>

        <section className="mt-5 max-w-[720px] rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="font-serif text-[17px] font-normal">{t('panelTitle')}</h2>
          <p className="mb-3.5 mt-[3px] text-[12.5px] text-muted-2">{t('panelLead')}</p>

          {failed ? (
            // Lecture en échec : aucune carte, un réglage vide serait pris pour la valeur réelle (audit R-16).
            <LoadError message={t('loadError')} onRetry={retry} />
          ) : visibility === null ? (
            <div aria-hidden="true">
              {MODES.map(({ value }) => (
                <div key={value} data-skeleton-card="" className="mb-2 flex items-start gap-3 rounded-lg border-[1.5px] border-border px-3.5 py-3">
                  <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded-full" />
                  <div className="flex-1">
                    <Skeleton className="h-3.5 w-44" />
                    <Skeleton className="mt-1.5 h-3 w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div role="radiogroup" aria-label={t('panelTitle')}>
              {MODES.map(({ value, available }) => (
                <ModeCard key={value} value={value} available={available} checked={visibility === value} />
              ))}
            </div>
          )}

          <p className="mt-3 text-xs text-muted-2">{t('footnote')}</p>
        </section>
      </div>
    </>
  );
}
