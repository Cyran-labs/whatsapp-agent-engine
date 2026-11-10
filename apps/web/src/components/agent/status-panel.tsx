'use client';

import { useId, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { StatusPill } from '@/components/agents/status-pill';
import { sendMutation } from '@/lib/api-fetch';
import { availableActions, type BotAction } from '@/lib/bot-transitions';
import type { BotView } from '@/lib/agent-types';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { CancelButton, DangerButton, DialogActions, PrimaryButton } from '@/components/connections/dialog-ui';
import { allowlistInputId } from './allowlist-panel';
import { ACTION, Card } from './panel-ui';

interface Props {
  bot: BotView;
  /** Admin hors lecture seule : seul lui voit les boutons de changement de statut. */
  canEdit: boolean;
  /** Relecture de la page après un changement, ou un refus qui laisse craindre un état périmé. */
  onChanged: () => void;
}

type ConfirmKind = 'open' | 'deactivate';

/**
 * Changements de statut qui se confirment (revue finale 2b-3 m-7, recette Q-1) : « Ouvrir à tous » et « Réactiver pour
 * tous » (l'agent IA répond à tous les contacts, avec le coût associé) et « Désactiver » (il cesse de répondre, c'est
 * la seule façon de l'arrêter depuis l'écran). Les autres changements ne se confirment pas.
 */
function confirmationFor(action: BotAction): ConfirmKind | null {
  if (action.key === 'open' || action.key === 'reopen') return 'open';
  if (action.key === 'deactivate') return 'deactivate';
  return null;
}

/** Ramène le curseur sur le champ d'ajout de la liste d'accès limité (encart voisin de la même page). */
function focusAllowlistField(botId: string): void {
  document.getElementById(allowlistInputId(botId))?.focus();
}

/** Statut de l'agent IA, actions permises par la machine d'états (contrats), messages non servis. Le moteur décide. */
export function StatusPanel({ bot, canEdit, onChanged }: Props) {
  const t = useTranslations('agentStatus');
  const format = useFormatter();
  const headingId = useId();
  const baseId = useId();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<{ message: string; emptyList: boolean } | null>(null);
  // Changement en attente de confirmation : rien n'est envoyé avant que l'admin confirme.
  const [pending, setPending] = useState<{ action: BotAction; kind: ConfirmKind } | null>(null);

  function request(action: BotAction) {
    const kind = confirmationFor(action);
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
    // Le moteur refuse d'entrer en accès limité sans entrée : le remède est dans l'encart voisin (recette Q-10).
    setError({ message: result.error, emptyList: result.reason === 'transition.empty_allowlist' });
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
      {bot.status === 'limited' && bot.allowlist.length === 0 && (
        // recette Q-10 : la liste vidée est permise, l'agent IA ne répond alors à personne ; le dire et proposer la suite.
        <div role="status" className="mt-3 rounded-lg bg-warning-soft px-3 py-2.5 text-[12.5px] text-warning-ink">
          <p className="font-semibold">{t('emptyList.text')}</p>
          {canEdit && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => focusAllowlistField(bot.bot_id)} className={ACTION}>{t('emptyList.add')}</button>
              {(['open', 'deactivate'] as const).map((key) => {
                const action = actions.find((a) => a.key === key);
                if (!action) return null;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!action.enabled || busy}
                    aria-describedby={action.reason ? `${baseId}-${action.target}` : undefined}
                    onClick={() => request(action)}
                    className={ACTION}
                  >
                    {t(`actions.${key}`)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
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
            <li key={action.target}>
              <span id={`${baseId}-${action.target}`}>
                {t.rich('unavailable', { action: t(`actions.${action.key}`), reason: t(`reasons.${action.reason}`), b: (chunks) => <b className="font-semibold text-muted">{chunks}</b> })}
              </span>
              {action.reason === 'empty_allowlist' && (
                <button type="button" onClick={() => focusAllowlistField(bot.bot_id)} className="ml-2 font-semibold text-fg underline">{t('emptyList.add')}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2.5 text-[12.5px] text-danger">
          {error.message}
          {error.emptyList && canEdit && (
            <button type="button" onClick={() => focusAllowlistField(bot.bot_id)} className="ml-2 font-semibold text-fg underline">{t('emptyList.add')}</button>
          )}
        </p>
      )}

      {pending && (
        <DialogFrame title={t(`confirm.${pending.kind}.title`, { bot: bot.name })} onClose={() => setPending(null)} busy={busy}>
          <p className="mb-2.5 text-[13px] text-muted">{t(`confirm.${pending.kind}.text`, { bot: bot.name })}</p>
          <DialogActions>
            <CancelButton busy={busy} onClick={() => setPending(null)}>{t('confirm.cancel')}</CancelButton>
            {pending.kind === 'deactivate' ? (
              <DangerButton type="button" disabled={busy} onClick={() => { const { action } = pending; setPending(null); void change(action); }}>
                {t('confirm.deactivate.confirm')}
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
