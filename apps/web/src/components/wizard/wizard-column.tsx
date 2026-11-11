'use client';

import { useTranslations } from 'next-intl';
import { MiddleColumn } from '@/components/shell/middle-column';
import { cn } from '@/lib/utils';
import type { Activated } from './step-activate';
import { Stepper, type StepIndex } from './stepper';

/**
 * Colonne du milieu de l'assistant (spec 12.1) : bloc Organisation, « ‹ Tous les agents IA », titre, stepper vertical,
 * puis l'encadré d'état qui dit ce qui est enregistré : rien avant « Créer et tester », le Draft ensuite, le statut
 * après l'activation (choix P-9).
 */
export function WizardColumn({
  step,
  furthest,
  created,
  activated,
  name,
  onGo,
}: {
  step: StepIndex | 'success';
  furthest: StepIndex;
  /** L'agent IA existe (après « Créer et tester », étape 2). */
  created: boolean;
  /** Renseigné par l'activation réussie ; `null` : pas d'activation. */
  activated: Activated | null;
  name: string;
  onGo: (step: StepIndex) => void;
}) {
  const t = useTranslations('wizard.column');
  const live = activated !== null;
  const box = live ? (
    <b className="block">
      <span aria-hidden="true">✓ </span>
      <span>{t(activated.status === 'active' ? 'liveActive' : 'liveLimited', { name })}</span>
    </b>
  ) : created ? (
    <>
      <b className="mb-0.5 block text-fg">
        <span aria-hidden="true">✓ </span>
        <span>{t('draftSavedTitle')}</span>
      </b>
      <span>{t('draftSavedText', { name })}</span>
    </>
  ) : (
    t('nothingSaved')
  );

  return (
    <MiddleColumn
      back={{ label: t('back'), href: '/' }}
      title={t('title')}
      groups={[]}
      activeKey=""
      body={
        <div className="px-0.5 pt-2">
          <Stepper current={step} furthest={furthest} onGo={onGo} />
          <div
            role="status"
            className={cn(
              'mx-1 mt-4 rounded-lg border px-3 py-2.5 text-[12.5px] leading-[1.45]',
              live ? 'border-success-soft bg-success-soft text-success-ink' : 'border-border bg-surface-subtle text-muted',
            )}
          >
            {box}
          </div>
        </div>
      }
    />
  );
}
