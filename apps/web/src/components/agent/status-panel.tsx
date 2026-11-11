'use client';

import { useId, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { NotRespondingReason, WhatsAppAccountStateView } from '@wabagent/contracts';
import { NotRespondingMention } from '@/components/agents/not-responding-mention';
import { OfflineReason } from '@/components/agents/offline-reason';
import { StatusPill } from '@/components/agents/status-pill';
import { InlineError } from '@/components/feedback/inline-error';
import { useDescribeFailure } from '@/components/feedback/use-describe-failure';
import { sendMutation } from '@/lib/api-fetch';
import { mentionTone, notRespondingTextKey, shownNotRespondingReason } from '@/lib/status-words';
import { NEUTRAL_MARK } from '@/components/agents/status-style';
import { Link } from '@/i18n/routing';
import { availableActions, type BotAction } from '@/lib/bot-transitions';
import type { BotView } from '@/lib/agent-types';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { CancelButton, DangerButton, DialogActions, PrimaryButton } from '@/components/connections/dialog-ui';
import { allowlistInputId } from './allowlist-panel';
import { AssignNumberDialog } from './assign-number-dialog';
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
  // Fenêtre de branchement ouverte depuis l'encadré « Ne répond pas » (aucun numéro, numéro retiré).
  const [assigning, setAssigning] = useState(false);

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
  // prototype 9 : plusieurs actions grisées pour la même raison (Draft sans numéro) n'ont qu'une ligne, la raison seule.
  const firstReason = unavailable[0]?.reason ?? null;
  const sharedReason = unavailable.length > 1 && unavailable.every((action) => action.reason === firstReason) ? firstReason : null;
  const reasonIdOf = (action: BotAction) => (sharedReason !== null ? `${baseId}-shared` : `${baseId}-${action.target}`);
  // Mention du moteur (`not_responding`), jamais recalculée ici ; seulement pour Preview et Online (point d'attention 4).
  const notResponding = shownNotRespondingReason(bot.status, bot.not_responding);
  const accountState = bot.whatsapp_number?.account.state ?? null;
  // Whitelist vide en Preview : l'encart et son action d'ajout restent affichés même quand la mention du moteur donne une
  // autre première cause (compte en erreur, spec 7.1), décision du contrôleur à la relecture de la tâche 7. Quand la
  // mention est la Whitelist vide, l'encadré neutre porte déjà l'action : pas d'encart en double.
  const emptyListNotice = bot.status === 'limited' && bot.allowlist.length === 0 && notResponding !== 'empty_allowlist';
  const { count, last_at: lastAt } = bot.unserved;
  // Le bloc n'existe que s'il a quelque chose à dire : hors Online, toujours (« aucun message non servi » rassure) ;
  // Online, seulement quand le moteur a compté des messages (compte non connecté, organisation suspendue).
  const showUnserved = bot.status !== 'active' || count > 0;

  return (
    <Card title={t('title')} labelledBy={headingId}>
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={bot.status} />
        {/* spec 6.1 : Offline toujours suivi de son motif, arrêt manuel compris */}
        {bot.status === 'paused' && <OfflineReason raw={bot.status_reason} />}
        {/* La phrase du statut (spec 6.1) n'est vraie que si l'agent IA répond : sinon l'encadré dit ce qui se passe
            (registre, relecture tâche 7 : « Répond seulement aux numéros de la Whitelist. » était affiché sans numéro). */}
        {notResponding === null && <p className="text-[12.5px] text-muted-2">{t(`description.${bot.status}`)}</p>}
      </div>
      {notResponding !== null && (
        <NotRespondingBox
          reason={notResponding}
          accountState={accountState}
          canEdit={canEdit}
          onAssign={() => setAssigning(true)}
          onAddEntry={() => focusAllowlistField(bot.bot_id)}
        />
      )}
      {emptyListNotice && (
        // recette Q-10 : la liste vidée est permise, l'agent IA ne répond alors à personne ; le dire et proposer la suite.
        // recette 3.5 (décision du PO) : un état, pas une erreur, ton neutre comme l'encadré « Whitelist vide », jamais ambre.
        <div data-empty-list-notice="" className={`mt-3 rounded-lg px-3 py-2.5 text-[12.5px] ${NEUTRAL_MARK}`}>
          {/* relecture tâche 9, m-7 : une seule région vivante ; quand l'encadré rouge annonce déjà la mention, cette phrase
              n'est pas une seconde annonce. */}
          <p role={notResponding === null ? 'status' : undefined} className="font-semibold text-fg">{t('emptyList.text')}</p>
          {canEdit && (
            <button type="button" onClick={() => focusAllowlistField(bot.bot_id)} className={`mt-2 ${ACTION}`}>{t('emptyList.add')}</button>
          )}
        </div>
      )}

      {/* spec 10.3 : « Passer Online » et « Passer Offline » restent dans la rangée, avec leur confirmation, même Whitelist
          vide : le chemin vers l'ouverture à tous n'est pas le plus court. */}
      {actions.length > 0 && (
        <ul className="mt-3.5 flex flex-wrap items-start gap-2">
          {actions.map((action) => {
            const reasonId = reasonIdOf(action);
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
      {sharedReason !== null && (
        <p className="mt-2.5 text-[12.5px] text-muted">
          <span id={`${baseId}-shared`}>{t(`reasons.${sharedReason}`)}</span>
          {sharedReason === 'empty_allowlist' && (
            <button type="button" onClick={() => focusAllowlistField(bot.bot_id)} className="ml-2 font-semibold text-fg underline">{t('emptyList.add')}</button>
          )}
        </p>
      )}
      {sharedReason === null && unavailable.length > 0 && (
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

      {assigning && (
        <AssignNumberDialog
          botId={bot.bot_id}
          bot={bot}
          currentNumber={bot.whatsapp_number}
          onClose={() => setAssigning(false)}
          onDone={() => {
            setAssigning(false);
            onChanged();
          }}
        />
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

/**
 * Encadré « Ne répond pas » de la page de l'agent IA (spec 10.3) : la mention écrite, ce qui se passe et l'action
 * utile. Admin : brancher ou changer le numéro (fenêtre de l'encart Numéro WhatsApp), ouvrir Connexions pour un compte
 * (choix P-2), ajouter une entrée à la Whitelist ; les autres membres : prévenir un administrateur. Rouge, sauf la
 * Whitelist vide (recette 3.5, spec 7.1) : un état, pas une erreur, encadré neutre « Whitelist vide » et l'invitation.
 */
function NotRespondingBox({
  reason,
  accountState,
  canEdit,
  onAssign,
  onAddEntry,
}: {
  reason: NotRespondingReason;
  accountState: WhatsAppAccountStateView | null;
  canEdit: boolean;
  onAssign: () => void;
  onAddEntry: () => void;
}) {
  const t = useTranslations('agentStatus');
  const tn = useTranslations('agentNumber');
  const tm = useTranslations('agents.notResponding');
  const action = !canEdit ? (
    <p>{t('notResponding.contactAdmin')}</p>
  ) : reason === 'no_number' ? (
    <button type="button" onClick={onAssign} className={ACTION}>{tn('assign')}</button>
  ) : reason === 'number_removed' ? (
    <button type="button" onClick={onAssign} className={ACTION}>{tn('change')}</button>
  ) : reason === 'account_not_connected' ? (
    <Link href="/organisation/connexions" className="font-semibold underline">{t('notResponding.openConnections')}</Link>
  ) : reason === 'empty_allowlist' ? (
    <button type="button" onClick={onAddEntry} className={ACTION}>{t('emptyList.add')}</button>
  ) : null;
  if (mentionTone(reason) === 'neutral') {
    return (
      <div data-not-responding="neutral" className={`mt-3 rounded-lg px-3 py-2.5 text-[12.5px] ${NEUTRAL_MARK}`}>
        <p role="status" className="font-semibold text-fg">{tm('emptyAllowlist.label')}</p>
        <p className="mt-1">{tm('emptyAllowlist.hint')}</p>
        {action && <div className="mt-2">{action}</div>}
      </div>
    );
  }
  return (
    <div data-not-responding="danger" className="mt-3 rounded-lg bg-danger-soft px-3 py-2.5 text-[12.5px] text-danger-ink">
      <p role="status"><NotRespondingMention reason={reason} accountState={accountState} variant="full" /></p>
      <p className="mt-1">{t(`notResponding.${notRespondingTextKey(reason, accountState)}`)}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
