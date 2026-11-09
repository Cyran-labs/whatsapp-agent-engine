'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isServingStatus, type WhatsAppNumberView } from '@wabagent/contracts';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { formatPhone } from '@/lib/whatsapp-display';
import { sendMutation } from '@/lib/api-fetch';
import { isHolderChanged } from '@/lib/holder-changed';
import { CancelButton, DangerButton, DialogActions, ErrorLine } from './dialog-ui';

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
}

export function UnassignDialog({ target, onClose, onDone, onStale }: Props) {
  const { number, bot } = target;
  const t = useTranslations('connections.unassign');
  const td = useTranslations('connections.dialogs');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
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
    setError(result.error);
    if (isHolderChanged(result)) {
      setStale(true);
      onStale();
    }
  }

  return (
    <DialogFrame title={t('title', { bot: bot.name })} onClose={onClose}>
      <p className="mb-2.5 text-[13px] text-muted">
        {t('text', { bot: bot.name, number: formatPhone(number.phone_e164) })}
        {serving && ` ${t('toDraft', { bot: bot.name })}`}
      </p>
      {error && <ErrorLine>{error}</ErrorLine>}
      <DialogActions>
        <CancelButton onClick={onClose}>{stale ? td('close') : td('cancel')}</CancelButton>
        {!stale && <DangerButton type="button" disabled={busy} onClick={() => void confirm()}>{t('confirm')}</DangerButton>}
      </DialogActions>
    </DialogFrame>
  );
}
