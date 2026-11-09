'use client';

import { useId, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { isServingStatus } from '@wabagent/contracts';
import { StatusPill } from '@/components/agents/status-pill';
import { sendMutation } from '@/lib/api-fetch';
import { availableActions, type BotAction } from '@/lib/bot-transitions';
import type { BotView } from '@/lib/agent-types';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { CancelButton, DangerButton, DialogActions, PrimaryButton } from '@/components/connections/dialog-ui';
import { ACTION, Card } from './panel-ui';

interface Props {
  bot: BotView;
  /** Admin hors lecture seule : seul lui voit les boutons de changement de statut. */
  canEdit: boolean;
  /** Relecture de la page après un changement, ou un refus qui laisse craindre un état périmé. */
  onChanged: () => void;
}

/**
 * Changements de statut qui se confirment (revue finale 2b-3 m-7) : « Ouvrir à tous » (l'agent IA répond à tous les
 * contacts, avec le coût associé) et « Revenir en brouillon » depuis l'accès limité ou actif (il cesse de répondre).
 * La pause, réversible et sans effet de coût, ne se confirme pas.
 */
function confirmationFor(from: string, action: BotAction): 'open' | 'draft' | null {
  if (action.key === 'open') return 'open';
  if (action.key === 'draft' && isServingStatus(from)) return 'draft';
  return null;
}

/** Statut de l'agent IA, actions permises par la machine d'états (contrats), messages non servis. Le moteur décide. */
export function StatusPanel({ bot, canEdit, onChanged }: Props) {
  const t = useTranslations('agentStatus');
  const format = useFormatter();
  const headingId = useId();
  const baseId = useId();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Changement en attente de confirmation : rien n'est envoyé avant que l'admin confirme.
  const [pending, setPending] = useState<{ action: BotAction; kind: 'open' | 'draft' } | null>(null);

  function request(action: BotAction) {
    const kind = confirmationFor(bot.status, action);
    if (kind === null) void change(action);
    else setPending({ action, kind });
  }

  async function change(action: BotAction) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const result = await sendMutation(
      `/api/bots/${encodeURIComponent(bot.bot_id)}/status`,
      'PUT',
      { status: action.target },
      t('failed'),
      'Agent',
    );
    busyRef.current = false;
    setBusy(false);
    if ('res' in result) {
      onChanged();
      return;
    }
    // Organisation changée dans un autre onglet : la page se recharge, rien à afficher.
    if (result.orgChanged) return;
    setError(result.error);
    // Un refus du moteur vient d'un état qui a bougé (compte, numéro, liste) : l'écran se relit.
    if (result.status === 409) onChanged();
  }

  const actions = canEdit ? availableActions(bot) : [];
  const unavailable = actions.filter((action): action is BotAction & { reason: NonNullable<BotAction['reason']> } => action.reason !== null);
  const { count, last_at: lastAt } = bot.unserved;

  return (
    <Card title={t('title')} labelledBy={headingId}>
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={bot.status} />
        <p className="text-[12.5px] text-muted-2">{t(`description.${bot.status}`)}</p>
      </div>
      {bot.status === 'paused' && bot.status_reason === 'number_removed' && (
        <p className="mt-2 text-[12.5px] text-danger">{t('numberRemoved')}</p>
      )}

      {actions.length > 0 && (
        <ul className="mt-3.5 flex flex-wrap items-start gap-2">
          {actions.map((action) => {
            const reasonId = `${baseId}-${action.target}`;
            return (
              <li key={action.target}>
                <button
                  type="button"
                  disabled={!action.enabled || busy}
                  aria-describedby={action.reason ? reasonId : undefined}
                  onClick={() => request(action)}
                  className={ACTION}
                >
                  {t(`actions.${action.key}`)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {unavailable.length > 0 && (
        // Sous la rangée, une ligne par action indisponible : la rangée de boutons ne bouge pas.
        <ul className="mt-2.5 space-y-1 text-[12.5px] text-muted">
          {unavailable.map((action) => (
            <li key={action.target} id={`${baseId}-${action.target}`}>
              {t.rich('unavailable', { action: t(`actions.${action.key}`), reason: t(`reasons.${action.reason}`), b: (chunks) => <b className="font-semibold text-muted">{chunks}</b> })}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2.5 text-[12.5px] text-danger">{error}</p>}

      {pending && (
        <DialogFrame title={t(`confirm.${pending.kind}.title`, { bot: bot.name })} onClose={() => setPending(null)}>
          <p className="mb-2.5 text-[13px] text-muted">{t(`confirm.${pending.kind}.text`, { bot: bot.name })}</p>
          <DialogActions>
            <CancelButton onClick={() => setPending(null)}>{t('confirm.cancel')}</CancelButton>
            {pending.kind === 'draft' ? (
              <DangerButton type="button" disabled={busy} onClick={() => { const { action } = pending; setPending(null); void change(action); }}>
                {t('confirm.draft.confirm')}
              </DangerButton>
            ) : (
              <PrimaryButton type="button" disabled={busy} onClick={() => { const { action } = pending; setPending(null); void change(action); }}>
                {t('confirm.open.confirm')}
              </PrimaryButton>
            )}
          </DialogActions>
        </DialogFrame>
      )}

      <div className="mt-3.5 border-t border-border pt-3 text-[13px]">
        {count === 0 ? (
          <p className="text-muted-2">{t('unservedNone')}</p>
        ) : (
          <>
            <p className="font-semibold text-fg">
              {lastAt
                ? t('unserved', { count, date: format.dateTime(new Date(lastAt), { dateStyle: 'medium', timeStyle: 'short' }) })
                : t('unservedUnknown', { count })}
            </p>
            <p className="mt-0.5 text-[12px] text-muted">{t('unservedHint')}</p>
          </>
        )}
      </div>
    </Card>
  );
}
