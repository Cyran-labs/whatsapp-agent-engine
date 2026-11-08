'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { OrganizationSettings } from '@wabagent/contracts';
import { useSession } from '@/components/providers/session-provider';

type Visibility = OrganizationSettings['visibility'];

const MODES: { value: Visibility; available: boolean }[] = [
  { value: 'all', available: true },
  { value: 'entities', available: false },
  { value: 'own_and_pool', available: false },
];

export default function ReglagesPage() {
  const t = useTranslations('organisation.settings');
  const tc = useTranslations('common');
  const { activeOrg } = useSession();
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/settings')
      .then((r) => (r.ok ? (r.json() as Promise<Pick<OrganizationSettings, 'visibility'>>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (alive) setVisibility(d.visibility); })
      .catch((err: unknown) => {
        console.error('[Settings] lecture impossible', err);
        if (alive) setFailed(true);
      });
    return () => { alive = false; };
  }, []);

  return (
    <>
      <div>
        <h1 className="font-serif text-[26px] font-normal leading-[1.1] text-fg">{t('title')}</h1>
        <p className="mt-[5px] max-w-[600px] text-[12.5px] text-muted-2">
          {t('subtitle', { name: activeOrg?.name ?? '' })}
        </p>
      </div>

      <section className="mt-5 max-w-[720px] rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="font-serif text-[17px] font-normal">{t('panelTitle')}</h2>
        <p className="mb-3.5 mt-[3px] text-[12.5px] text-muted-2">{t('panelLead')}</p>

        {failed && (
          <p role="alert" className="mb-2 text-[12.5px] text-danger">{tc('error')}</p>
        )}

        <div role="radiogroup" aria-label={t('panelTitle')}>
          {MODES.map(({ value, available }) => {
            const checked = visibility === value;
            const titleId = `visibility-${value}`;
            return (
              <div
                key={value}
                role="radio"
                aria-checked={checked}
                aria-disabled={available ? undefined : true}
                aria-labelledby={titleId}
                className={`mb-2 flex items-start gap-3 rounded-lg border-[1.5px] px-3.5 py-3 text-[12.5px] ${
                  checked
                    ? 'border-accent-ink bg-accent-soft text-muted'
                    : 'border-border text-muted-2'
                } ${available ? '' : 'opacity-60'}`}
              >
                <span
                  className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded-full bg-surface ${
                    checked ? 'border-[5px] border-accent-ink' : 'border-[1.5px] border-border-strong'
                  }`}
                  aria-hidden="true"
                />
                <div>
                  <b id={titleId} className="mb-px block text-[13.5px] font-semibold text-fg">{t(`modes.${value}.title`)}</b>
                  {t(`modes.${value}.description`)}
                </div>
                {!available && (
                  <span className="ml-auto self-center whitespace-nowrap rounded-pill border border-border px-2 py-px text-[9.5px] uppercase tracking-[0.5px] text-muted-2">
                    {t('soon')}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-muted-2">{t('footnote')}</p>
      </section>
    </>
  );
}
