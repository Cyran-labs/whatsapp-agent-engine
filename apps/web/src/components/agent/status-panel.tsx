'use client';

import { useId, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { StatusPill } from '@/components/agents/status-pill';
import { sendMutation } from '@/lib/api-fetch';
import { availableActions, type BotAction } from '@/lib/bot-transitions';
import type { BotView } from '@/lib/agent-types';
import { ACTION, Card } from './panel-ui';

interface Props {
  bot: BotView;
  /** Admin hors lecture seule : seul lui voit les boutons de changement de statut. */
  canEdit: boolean;
  /** Relecture de la page après un changement, ou un refus qui laisse craindre un état périmé. */
  onChanged: () => void;
}

/** Libellé de l'action : « Revenir en accès limité » depuis actif, « Activer en accès limité » depuis le brouillon. */
function labelKey(action: BotAction, from: BotView['status']): string {
  return action.key === 'limit' && from === 'active' ? 'backToLimited' : action.key;
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
        <ul className="mt-3.5 flex flex-wrap items-start gap-x-4 gap-y-3">
          {actions.map((action) => {
            const reasonId = `${baseId}-${action.key}-${action.target}`;
            return (
              <li key={action.target} className="max-w-[240px]">
                <button
                  type="button"
                  disabled={!action.enabled || busy}
                  aria-describedby={action.reason ? reasonId : undefined}
                  onClick={() => void change(action)}
                  className={ACTION}
                >
                  {t(`actions.${labelKey(action, bot.status)}`)}
                </button>
                {action.reason && <p id={reasonId} className="mt-1 text-[12px] text-muted-2">{t(`reasons.${action.reason}`)}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="mt-2.5 text-[12.5px] text-danger">{error}</p>}

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
            <p className="mt-0.5 text-[12px] text-muted-2">{t('unservedHint')}</p>
          </>
        )}
      </div>
    </Card>
  );
}
