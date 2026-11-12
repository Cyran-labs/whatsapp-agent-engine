'use client';

import { useTranslations } from 'next-intl';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { CancelButton, DangerButton, DialogActions } from '@/components/connections/dialog-ui';

/**
 * Confirmation de sortie de l'assistant (spec 12.4, choix P-8) : ouverte par la garde de navigation quand une saisie
 * serait perdue. Échap vaut « Rester ».
 */
export function LeaveDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const t = useTranslations('wizard.leave');
  return (
    <DialogFrame title={t('title')} onClose={onStay}>
      <p className="mb-2.5 text-[13px] text-muted">{t('text')}</p>
      <DialogActions>
        <CancelButton onClick={onStay}>{t('stay')}</CancelButton>
        <DangerButton type="button" onClick={onLeave}>
          {t('confirm')}
        </DangerButton>
      </DialogActions>
    </DialogFrame>
  );
}
