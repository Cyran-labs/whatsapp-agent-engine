'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import type { ChecklistState, ConnectTarget } from '@/lib/onboarding';

const STEPS = [
  { key: 'created', label: 'stepCreated' },
  { key: 'personalized', label: 'stepPersonalized' },
  { key: 'connected', label: 'stepConnect' },
  { key: 'active', label: 'stepActivate' },
] as const;

/**
 * `canConnect` : brancher un numéro est réservé aux administrateurs de l'organisation. `connect` : destination de
 * « Brancher un numéro », choisie par `connectTarget` (page du premier agent IA Draft sans numéro, sinon Connexions,
 * suivi de « ↗ Connexions » parce que le lien change d'espace, A-7).
 */
export function SetupBanner({
  checklist,
  hasActive,
  canConnect,
  connect,
}: {
  checklist: ChecklistState;
  hasActive: boolean;
  canConnect: boolean;
  connect: ConnectTarget;
}) {
  const t = useTranslations('agents');
  if (hasActive) return null;
  return (
    <div className="mb-7 flex items-center gap-5 rounded-xl border border-border border-l-[3px] border-l-accent-ink bg-surface px-5 py-4 shadow-sm">
      <div className="font-serif text-[17px]">
        {t('setupTitle')}
        <small className="mt-px block font-sans text-[12.5px] text-muted-2">{t('setupSubtitle')}</small>
      </div>
      <div className="flex flex-1 justify-center gap-5">
        {STEPS.map((s, i) => {
          const done = checklist[s.key];
          const isNext = !done && STEPS.slice(0, i).every((p) => checklist[p.key]);
          const tone = done ? 'text-fg' : isNext ? 'font-semibold text-accent-ink' : 'text-muted-2';
          const dot = done ? 'bg-success text-white' : isNext ? 'border border-accent-ink bg-accent-soft text-accent-ink' : 'border border-border-strong bg-surface-subtle text-muted-2';
          return (
            <div key={s.key} className={`flex items-center gap-2 text-[13px] ${tone}`}>
              <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-pill text-[10px] font-bold ${dot}`}>{done ? '✓' : i + 1}</span>
              {t(s.label)}
            </div>
          );
        })}
      </div>
      {canConnect && !checklist.connected && (
        <Link href={connect.href} className="whitespace-nowrap rounded-md bg-accent px-[18px] py-2.5 font-bold text-accent-fg hover:bg-accent-hover">
          {t('connectCta')}
          {connect.external && <span className="ml-1.5 text-[12px] font-semibold">↗ {t('connectSpace')}</span>}
        </Link>
      )}
    </div>
  );
}
