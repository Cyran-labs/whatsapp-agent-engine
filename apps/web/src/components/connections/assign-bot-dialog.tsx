'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isServingStatus, type WhatsAppAccountView, type WhatsAppNumberView } from '@wabagent/contracts';
import { Link } from '@/i18n/routing';
import { StatusPill } from '@/components/agents/status-pill';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { apiFetch, isOrgChanged, sendMutation } from '@/lib/api-fetch';
import { formatPhone } from '@/lib/whatsapp-display';
import { CancelButton, DialogActions, ErrorLine, PrimaryButton } from './dialog-ui';

interface Props {
  account: WhatsAppAccountView;
  number: WhatsAppNumberView;
  onClose: () => void;
  /** Branchement accepté par le moteur. */
  onDone: () => void;
}

/** Agent IA tel que `GET /api/bots` le renvoie (agents IA de l'organisation courante seulement). */
interface BotRow {
  bot_id: string;
  name: string;
  status: string;
  whatsapp_number: { id: number; phone_e164: string } | null;
}

type Listing = { phase: 'loading' } | { phase: 'failed' } | { phase: 'ready'; bots: BotRow[] };

/** Choix de l'agent IA qui reçoit le numéro. Le moteur décide du branchement ; son refus s'affiche tel quel. */
export function AssignBotDialog({ number, onClose, onDone }: Props) {
  const t = useTranslations('connections.assign');
  const td = useTranslations('connections.dialogs');
  const hintId = useId();
  const [listing, setListing] = useState<Listing>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [botId, setBotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/bots')
      .then(async (res) => {
        if (await isOrgChanged(res)) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list: unknown = await res.json();
        if (!Array.isArray(list)) throw new Error('réponse inattendue');
        if (alive) setListing({ phase: 'ready', bots: list as BotRow[] });
      })
      .catch((err: unknown) => {
        console.error('[Connections] liste des agents IA illisible', err);
        if (alive) setListing({ phase: 'failed' });
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  async function submit() {
    if (busyRef.current || botId === null) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const result = await sendMutation(`/api/bots/${encodeURIComponent(botId)}/number`, 'PUT', { number_id: number.id }, td('failed'), 'Connections');
    busyRef.current = false;
    setBusy(false);
    if ('res' in result) onDone();
    else if (!result.orgChanged) setError(result.error);
  }

  const current = number.bot;
  // Spec 2b §7.5 : l'agent IA qui perd le numéro repasse en brouillon s'il était en accès limité ou actif.
  const currentServing = current !== null && isServingStatus(current.status);

  return (
    <DialogFrame title={t('title')} onClose={onClose}>
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
            <CancelButton onClick={() => { setListing({ phase: 'loading' }); setAttempt((n) => n + 1); }}>{td('retry')}</CancelButton>
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
          {listing.bots.map((bot) => {
            const here = current?.bot_id === bot.bot_id;
            const note = here
              ? t('alreadyHere')
              : bot.whatsapp_number
                ? t('losesNumber', { number: formatPhone(bot.whatsapp_number.phone_e164) })
                : null;
            return (
              <label
                key={bot.bot_id}
                className={`flex items-start gap-2.5 border-t border-border px-3 py-2.5 first:border-t-0 ${here ? 'cursor-default opacity-70' : 'cursor-pointer hover:bg-surface-subtle'}`}
              >
                <input
                  type="radio"
                  name="assign-bot"
                  value={bot.bot_id}
                  checked={botId === bot.bot_id}
                  disabled={here}
                  onChange={() => setBotId(bot.bot_id)}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
                    {bot.name}
                    <StatusPill status={bot.status} />
                  </span>
                  {note && <span className="mt-0.5 block text-[12px] text-muted-2">{note}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      {listing.phase === 'ready' && listing.bots.length > 0 && botId === null && (
        <p id={hintId} className="mt-2 text-[12px] text-muted-2">{t('choose')}</p>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}

      <DialogActions>
        <CancelButton onClick={onClose}>{td('cancel')}</CancelButton>
        <PrimaryButton
          type="button"
          disabled={busy || botId === null}
          aria-describedby={botId === null ? hintId : undefined}
          onClick={() => void submit()}
        >
          {t('submit')}
        </PrimaryButton>
      </DialogActions>
    </DialogFrame>
  );
}
