'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppNumberView } from '@wabagent/contracts';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { formatPhone } from '@/lib/whatsapp-display';
import { sendMutation } from '@/lib/api-fetch';
import { CancelButton, DangerButton, DialogActions, ErrorLine } from './dialog-ui';

interface Props {
  number: WhatsAppNumberView;
  /** L'agent IA branché sur le numéro. */
  bot: NonNullable<WhatsAppNumberView['bot']>;
  onClose: () => void;
  /** Débranchement accepté par le moteur. */
  onDone: () => void;
}

export function UnassignDialog({ number, bot, onClose, onDone }: Props) {
  const t = useTranslations('connections.unassign');
  const td = useTranslations('connections.dialogs');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Spec 2b §7.5 : l'agent IA en accès limité ou actif repasse en brouillon quand il perd son numéro.
  const serving = bot.status === 'limited' || bot.status === 'active';

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const result = await sendMutation(`/api/bots/${encodeURIComponent(bot.bot_id)}/number`, 'DELETE', undefined, td('failed'), 'Connections');
    busyRef.current = false;
    setBusy(false);
    if ('res' in result) onDone();
    else if (!result.orgChanged) setError(result.error);
  }

  return (
    <DialogFrame title={t('title', { bot: bot.name })} onClose={onClose}>
      <p className="mb-2.5 text-[13px] text-muted">
        {t('text', { bot: bot.name, number: formatPhone(number.phone_e164) })}
        {serving && ` ${t('toDraft', { bot: bot.name })}`}
      </p>
      {error && <ErrorLine>{error}</ErrorLine>}
      <DialogActions>
        <CancelButton onClick={onClose}>{td('cancel')}</CancelButton>
        <DangerButton type="button" disabled={busy} onClick={() => void confirm()}>{t('confirm')}</DangerButton>
      </DialogActions>
    </DialogFrame>
  );
}
