'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isServingStatus, type WhatsAppAccountStateView, type WhatsAppNumberView } from '@wabagent/contracts';
import { Link } from '@/i18n/routing';
import { OfflineReason } from '@/components/agents/offline-reason';
import { StatusPill } from '@/components/agents/status-pill';
import { InlineError } from '@/components/feedback/inline-error';
import { useDescribeFailure } from '@/components/feedback/use-describe-failure';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { apiFetch, isOrgChanged, sendMutation } from '@/lib/api-fetch';
import { assignRefusal, assignRefusalKey } from '@/lib/assign-choice';
import type { DescribedFailure } from '@/lib/describe-failure';
import { isHolderChanged } from '@/lib/holder-changed';
import { useRefreshOnVisible } from '@/lib/use-refresh-on-visible';
import { formatPhone } from '@/lib/whatsapp-display';
import { CancelButton, DialogActions, ErrorLine, PrimaryButton } from './dialog-ui';
import { errorText } from '@/lib/error-text';

interface Props {
  number: WhatsAppNumberView;
  /** État du compte du numéro, tel que la carte l'affiche : il décide, avec le statut, des agents IA choisissables. */
  accountState: WhatsAppAccountStateView;
  onClose: () => void;
  /** Branchement accepté par le moteur. */
  onDone: () => void;
  /** Le numéro a changé de détenteur depuis la lecture de la page : la page relit ses comptes (la fenêtre reste ouverte). */
  onStale: () => void;
}

/** Agent IA tel que `GET /api/bots` le renvoie (agents IA de l'organisation courante seulement). */
interface BotRow {
  bot_id: string;
  name: string;
  status: string;
  /** Motif brut d'une pause automatique, lu par `OfflineReason` ; absent ou nul pour un arrêt manuel. */
  status_reason?: string | null;
  whatsapp_number: { id: number; phone_e164: string } | null;
}

type Listing = { phase: 'loading' } | { phase: 'failed' } | { phase: 'ready'; bots: BotRow[] };

/** Choix de l'agent IA qui reçoit le numéro. Le moteur décide du branchement ; son refus s'affiche dans la fenêtre. */
export function AssignBotDialog({ number, accountState, onClose, onDone, onStale }: Props) {
  const t = useTranslations('connections.assign');
  const tRoot = useTranslations();
  const td = useTranslations('connections.dialogs');
  const hintId = useId();
  const keepsId = useId();
  const ts = useTranslations('agents.status');
  const describe = useDescribeFailure();
  const [listing, setListing] = useState<Listing>({ phase: 'loading' });
  const [botId, setBotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<DescribedFailure | null>(null);

  // Seule la dernière lecture compte ; une réponse arrivée après la fermeture est ignorée.
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    try {
      const res = await apiFetch('/api/bots');
      if (await isOrgChanged(res)) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list: unknown = await res.json();
      if (!Array.isArray(list)) throw new Error('réponse inattendue');
      if (mine === sequence.current) setListing({ phase: 'ready', bots: list as BotRow[] });
    } catch (err: unknown) {
      console.error('[Connections] liste des agents IA illisible', errorText(err));
      // Une relecture en échec garde la liste déjà affichée.
      if (mine === sequence.current) setListing((previous) => (previous.phase === 'ready' ? previous : { phase: 'failed' }));
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      sequence.current += 1;
    };
  }, [load]);
  // Un agent IA créé, archivé ou rebranché dans un autre onglet : la liste se relit au retour (revue finale 2b-3 m-9).
  useRefreshOnVisible(() => void load());

  // recette 3.7 : décision des contrats pour chaque agent IA (Draft et Offline acceptés sur un compte en erreur, Preview
  // et Online refusés avec leur raison) ; le moteur décide de nouveau à l'écriture.
  const refusalOf = (bot: BotRow) => assignRefusal(bot, number, accountState);

  // Un agent IA choisi qui a disparu de la liste relue, ou qui n'est plus choisissable : le choix est à refaire.
  useEffect(() => {
    if (listing.phase !== 'ready' || botId === null) return;
    const chosen = listing.bots.find((b) => b.bot_id === botId);
    if (!chosen || assignRefusal(chosen, number, accountState) !== null) setBotId(null);
  }, [listing, botId, number, accountState]);

  async function submit() {
    if (busyRef.current || botId === null) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    // Détenteur vu par l'écran : le moteur refuse (409) si le numéro a changé de main entre-temps (revue 2b-3 M-1).
    const body = { number_id: number.id, expected_bot_id: number.bot?.bot_id ?? null };
    const result = await sendMutation(`/api/bots/${encodeURIComponent(botId)}/number`, 'PUT', body, td('failed'), 'Connections');
    busyRef.current = false;
    setBusy(false);
    if ('res' in result) {
      onDone();
      return;
    }
    if (result.orgChanged) return;
    setError(describe(result, td('failed')));
    if (isHolderChanged(result)) {
      // Le choix est à refaire sur la liste relue : l'avertissement du nouveau détenteur s'affiche avant la confirmation.
      setBotId(null);
      onStale();
    }
  }

  const current = number.bot;
  // Spec 2b §7.5 (décision de François A9) : l'agent IA qui perd le numéro passe en Désactivé s'il était en accès limité ou actif.
  const chosenBot = listing.phase === 'ready' ? (listing.bots.find((b) => b.bot_id === botId) ?? null) : null;
  // Spec 2b §7.5 : un agent IA en accès limité ou actif qui change de numéro garde son statut, le nouveau numéro
  // sert tout de suite et l'ancien n'est plus servi.
  const keepsStatus = chosenBot !== null && chosenBot.whatsapp_number !== null && isServingStatus(chosenBot.status);
  const currentServing = current !== null && isServingStatus(current.status);
  // Les indices ne sont rendus que dans certains états : `aria-describedby` ne vise que ce qui est affiché.
  const hintShown = listing.phase === 'ready' && listing.bots.length > 0 && botId === null;
  const keepsShown = keepsStatus && chosenBot !== null && chosenBot.whatsapp_number !== null;

  return (
    <DialogFrame title={t('title')} onClose={onClose} busy={busy}>
      <p className="mb-2.5 text-[13px] text-muted">{t('text', { number: formatPhone(number.phone_e164) })}</p>

      {current && (
        <p role="status" className="mb-2.5 rounded-lg bg-warning-soft px-3 py-2 text-[12.5px] text-warning-ink">
          {t('currentWarning', { bot: current.name, serving: currentServing ? 'yes' : 'no' })}
        </p>
      )}

      {listing.phase === 'loading' && <p className="text-[13px] text-muted-2" aria-busy="true">{t('loading')}</p>}

      {listing.phase === 'failed' && (
        <>
          <ErrorLine>{t('loadFailed')}</ErrorLine>
          <div className="mt-2">
            <CancelButton onClick={() => { setListing({ phase: 'loading' }); void load(); }}>{td('retry')}</CancelButton>
          </div>
        </>
      )}

      {listing.phase === 'ready' && listing.bots.length === 0 && (
        <div className="text-[13px] text-muted">
          <p>{t('empty')}</p>
          <Link href="/agents/new" className="mt-1.5 inline-block font-semibold underline">{t('create')}</Link>
        </div>
      )}

      {listing.phase === 'ready' && listing.bots.length > 0 && (
        <fieldset className="max-h-[260px] overflow-auto rounded-lg border border-border">
          <legend className="sr-only">{t('legend')}</legend>
          {listing.bots.map((bot, index) => {
            const here = current?.bot_id === bot.bot_id;
            const refusal = here ? null : refusalOf(bot);
            // Position dans la liste : un identifiant d'agent IA peut porter des espaces, interdits dans un `id` cité.
            const refusedId = `${hintId}-refused-${index}`;
            const note = here
              ? t('alreadyHere')
              : bot.whatsapp_number && refusal === null
                ? t('losesNumber', { number: formatPhone(bot.whatsapp_number.phone_e164) })
                : null;
            const off = here || refusal !== null;
            return (
              <label
                key={bot.bot_id}
                className={`flex items-start gap-2.5 border-t border-border px-3 py-2.5 first:border-t-0 ${here ? 'cursor-default opacity-70' : refusal !== null ? 'cursor-not-allowed bg-surface-subtle' : 'cursor-pointer hover:bg-surface-subtle'}`}
              >
                <input
                  type="radio"
                  name="assign-bot"
                  value={bot.bot_id}
                  checked={botId === bot.bot_id && !off}
                  disabled={off}
                  aria-describedby={refusal !== null ? refusedId : undefined}
                  onChange={() => setBotId(bot.bot_id)}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
                    {bot.name}
                    <StatusPill status={bot.status} />
                    {/* spec 6.1 : Offline toujours suivi de son motif (relecture tâche 7, I-1) */}
                    {bot.status === 'paused' && <OfflineReason raw={bot.status_reason} />}
                  </span>
                  {note && <span className="mt-0.5 block text-[12px] text-muted">{note}</span>}
                  {refusal !== null && <span id={refusedId} className="mt-0.5 block text-[12px] text-muted">{tRoot(assignRefusalKey(refusal))}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      {keepsStatus && chosenBot !== null && chosenBot.whatsapp_number !== null && (
        <p id={keepsId} role="status" className="mt-2.5 rounded-lg bg-warning-soft px-3 py-2 text-[12.5px] text-warning-ink">
          {t('keepsStatus', {
            bot: chosenBot.name,
            status: ts(chosenBot.status),
            number: formatPhone(number.phone_e164),
            old: formatPhone(chosenBot.whatsapp_number.phone_e164),
            audience: chosenBot.status === 'active' ? 'active' : 'limited',
          })}
        </p>
      )}
      {hintShown && (
        <p id={hintId} className="mt-2 text-[12px] text-muted">{t('choose')}</p>
      )}
      {error && (
        <div className="mt-2">
          <InlineError message={error.message} reference={error.reference} />
        </div>
      )}

      <DialogActions>
        <CancelButton busy={busy} onClick={onClose}>{td('cancel')}</CancelButton>
        <PrimaryButton
          type="button"
          disabled={busy || botId === null}
          aria-describedby={hintShown ? hintId : keepsShown ? keepsId : undefined}
          onClick={() => void submit()}
        >
          {t('submit')}
        </PrimaryButton>
      </DialogActions>
    </DialogFrame>
  );
}
