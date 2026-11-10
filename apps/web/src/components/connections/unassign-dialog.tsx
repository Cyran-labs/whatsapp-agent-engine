'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isServingStatus, type WhatsAppNumberView } from '@wabagent/contracts';
import { InlineError } from '@/components/feedback/inline-error';
import { useDescribeFailure } from '@/components/feedback/use-describe-failure';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { formatPhone } from '@/lib/whatsapp-display';
import { sendMutation } from '@/lib/api-fetch';
import { isHolderChanged } from '@/lib/holder-changed';
import { CancelButton, DangerButton, DialogActions } from './dialog-ui';

/**
 * Ce que l'écran affichait quand la fenêtre a été ouverte : le numéro et l'agent IA branché dessus. Figé à l'ouverture
 * par l'appelant (pas relu depuis la page) : le moteur compare ce numéro au numéro réellement branché (revue finale
 * 2b-3 I-2), et la fenêtre doit survivre à une relecture qui montre un autre état.
 */
export interface UnassignTarget {
  number: Pick<WhatsAppNumberView, 'id' | 'phone_e164'>;
  bot: { bot_id: string; name: string; status: string };
}

interface Props {
  target: UnassignTarget;
  onClose: () => void;
  /** Débranchement accepté par le moteur. */
  onDone: () => void;
  /** Le numéro de l'agent IA a changé depuis la lecture de la page : la page se relit (la fenêtre reste ouverte). */
  onStale: () => void;
  /** Texte propre à l'écran pour le refus « numéro changé » ; à défaut, le texte de la clé du refus. */
  staleMessage?: string;
}

export function UnassignDialog({ target, onClose, onDone, onStale, staleMessage }: Props) {
  const { number, bot } = target;
  const t = useTranslations('connections.unassign');
  const td = useTranslations('connections.dialogs');
  const describe = useDescribeFailure();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<{ message: string; reference: string | null } | null>(null);
  // Refus « numéro changé » : la demande ne vaut plus, il n'y a plus rien à confirmer.
  const [stale, setStale] = useState(false);
  // Spec 2b §7.5 : l'agent IA en accès limité ou actif repasse en brouillon quand il perd son numéro.
  const serving = isServingStatus(bot.status);

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    // Numéro que l'écran affichait : le moteur refuse (409) si l'agent IA en a un autre ou n'en a plus (revue finale 2b-3 I-2).
    const result = await sendMutation(
      `/api/bots/${encodeURIComponent(bot.bot_id)}/number/unassign`, 'POST', { expected_number_id: number.id }, td('failed'), 'Connections',
    );
    busyRef.current = false;
    setBusy(false);
    if ('res' in result) {
      onDone();
      return;
    }
    if (result.orgChanged) return;
    const failure = describe(result, td('failed'));
    if (isHolderChanged(result)) {
      setError({ message: staleMessage ?? failure.message, reference: null });
      setStale(true);
      onStale();
      return;
    }
    setError({ message: failure.message, reference: failure.reference });
  }

  return (
    <DialogFrame title={t('title', { bot: bot.name })} onClose={onClose} busy={busy}>
      <p className="mb-2.5 text-[13px] text-muted">
        {t('text', { bot: bot.name, number: formatPhone(number.phone_e164) })}
        {serving && ` ${t('toDraft', { bot: bot.name })}`}
      </p>
      {error && (
        <div className="mt-2">
          <InlineError message={error.message} reference={error.reference} />
        </div>
      )}
      <DialogActions>
        <CancelButton busy={busy} onClick={onClose}>{stale ? td('close') : td('cancel')}</CancelButton>
        {!stale && <DangerButton type="button" disabled={busy} onClick={() => void confirm()}>{t('confirm')}</DangerButton>}
      </DialogActions>
    </DialogFrame>
  );
}
