'use client';

import { useId, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { OfflineReason } from '@/components/agents/offline-reason';
import { StatusPill } from '@/components/agents/status-pill';
import { InlineError } from '@/components/feedback/inline-error';
import { useDescribeFailure } from '@/components/feedback/use-describe-failure';
import { sendMutation } from '@/lib/api-fetch';
import { notRespondingTextKey } from '@/lib/status-words';
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
  /** Relecture de la page après un changement enregistré. */
  onChanged: () => void;
  /** Relecture après un refus qui laisse craindre un état périmé (rien n'a été enregistré) ; `onChanged` à défaut. */
  onStale?: () => void;
}

type ConfirmKind = 'open' | 'reopen' | 'limitAccess' | 'deactivate';

/**
 * Changements de statut qui se confirment (revue finale 2b-3 m-7, recette Q-1), chacun dans une fenêtre à son nom :
 * « Passer Online » et « Repasser Online » (l'agent IA répond à tous les contacts, avec le coût associé),
 * « Limiter à la Whitelist » (les contacts hors de la Whitelist cessent de recevoir une réponse, décision de François
 * A11), et « Passer Offline » (il cesse de répondre, c'est la seule façon de l'arrêter depuis l'écran). Les autres
 * changements ne se confirment pas.
 */
function confirmationFor(action: BotAction): ConfirmKind | null {
  if (action.key === 'open') return 'open';
  if (action.key === 'reopen') return 'reopen';
  if (action.key === 'limitAccess') return 'limitAccess';
  if (action.key === 'deactivate') return 'deactivate';
  return null;
}

/** Ramène le curseur sur le champ d'ajout de la Whitelist (encart voisin de la même page). */
function focusAllowlistField(botId: string): void {
  document.getElementById(allowlistInputId(botId))?.focus();
}

/** Statut de l'agent IA, actions permises par la machine d'états (contrats), messages non servis. Le moteur décide. */
export function StatusPanel({ bot, canEdit, onChanged, onStale }: Props) {
  const t = useTranslations('agentStatus');
  const format = useFormatter();
  const describe = useDescribeFailure();
  const headingId = useId();
  const baseId = useId();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<{ message: string; reference: string | null; emptyList: boolean } | null>(null);
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
    // Le moteur refuse d'entrer en Preview sans entrée : le remède est dans l'encart voisin (recette Q-10).
    const failure = describe(result, t('failed'));
    setError({ message: failure.message, reference: failure.reference, emptyList: result.reason === 'transition.empty_allowlist' });
    // Un refus du moteur vient d'un état qui a bougé (compte, numéro, liste) : l'écran se relit.
    if (result.status === 409) (onStale ?? onChanged)();
  }

  const actions = canEdit ? availableActions(bot) : [];
  const unavailable = actions.filter((action): action is BotAction & { reason: NonNullable<BotAction['reason']> } => action.reason !== null);
  // Whitelist vide en Preview : l'encart et son action d'ajout restent affichés même quand la mention du moteur donne une
  // autre première cause (compte en erreur, spec 7.1), décision du contrôleur à la relecture de la tâche 7. Ce n'est pas
  // la mention : celle-ci reste `not_responding`, lue du moteur. L'encart porte « Passer Online » et « Passer Offline »,
  // la rangée ne les répète pas (l'encadré complet est à la tâche 9).
  const emptyListNotice = bot.status === 'limited' && bot.allowlist.length === 0;
  const rowActions = emptyListNotice ? actions.filter((action) => action.key !== 'open' && action.key !== 'deactivate') : actions;
  const { count, last_at: lastAt } = bot.unserved;
  // Le bloc n'existe que s'il a quelque chose à dire : hors Online, toujours (« aucun message non servi » rassure) ;
  // Online, seulement quand le moteur a compté des messages (compte non connecté, organisation suspendue).
  const showUnserved = bot.status !== 'active' || count > 0;
  // contre-audit D-1 : en Preview ou Online, un compte qui n'est pas connecté ne sert aucun message : la description ne
  // promet pas de réponse. Le cas vient de la mention du moteur (`not_responding`) ; « non connecté » ou « en erreur »
  // est choisi par `notRespondingTextKey`, la règle de la mention (spec 7.1), relecture tâche 7, M-1.
  const accountKey = bot.not_responding === 'account_not_connected'
    ? notRespondingTextKey(bot.not_responding, bot.whatsapp_number?.account.state ?? null)
    : null;
  const description = accountKey === 'account_disconnected' ? 'accountNotConnected' : accountKey === 'account_error' ? 'accountError' : bot.status;

  return (
    <Card title={t('title')} labelledBy={headingId}>
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={bot.status} />
        {/* spec 6.1 : Offline toujours suivi de son motif, arrêt manuel compris */}
        {bot.status === 'paused' && <OfflineReason raw={bot.status_reason} />}
        {/* recette 10 nov. 2026 : l'encart « ne répond à personne » dit déjà la même chose, la phrase du statut n'est pas répétée au-dessus */}
        {!(emptyListNotice && description === 'limited') && (
          <p className="text-[12.5px] text-muted-2">{t(`description.${description}`)}</p>
        )}
      </div>
      {emptyListNotice && (
        // recette Q-10 : la liste vidée est permise, l'agent IA ne répond alors à personne ; le dire et proposer la suite.
        <div className="mt-3 rounded-lg bg-warning-soft px-3 py-2.5 text-[12.5px] text-warning-ink">
          <p role="status" className="font-semibold">{t('emptyList.text')}</p>
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

      {rowActions.length > 0 && (
        <ul className="mt-3.5 flex flex-wrap items-start gap-2">
          {rowActions.map((action) => {
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
        <div className="mt-2.5">
          <InlineError
            message={error.message}
            reference={error.reference}
            action={error.emptyList && canEdit ? (
              <button type="button" onClick={() => focusAllowlistField(bot.bot_id)} className="font-semibold text-fg underline">{t('emptyList.add')}</button>
            ) : undefined}
          />
        </div>
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
                {t(`confirm.${pending.kind}.confirm`)}
              </PrimaryButton>
            )}
          </DialogActions>
        </DialogFrame>
      )}

      {showUnserved && (
        // recette 10 nov. 2026 : hors Online, le bloc est toujours là, avec un indice adapté au statut ; Online, il
        // n'apparaît que si le moteur a compté des messages non servis (`showUnserved`), sans l'indice « décider de
        // passer Online plus tôt ». Le compteur est cumulatif : l'indice d'Online le dit.
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
              <p className="mt-0.5 text-[12px] text-muted">{t(`unservedHint.${bot.status}`)}</p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
