'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isServingStatus, type WhatsAppAccountView } from '@wabagent/contracts';
import { Link } from '@/i18n/routing';
import { CancelButton, DialogActions, ErrorLine, PrimaryButton } from '@/components/connections/dialog-ui';
import { NumberPicker, selectableGroups } from '@/components/numbers/number-picker';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { apiFetch, isOrgChanged, sendMutation } from '@/lib/api-fetch';
import { useRefreshOnVisible } from '@/lib/use-refresh-on-visible';
import { isHolderChanged } from '@/lib/holder-changed';
import { formatPhone } from '@/lib/whatsapp-display';

interface Props {
  botId: string;
  /** L'agent IA : en accès limité ou actif, un changement de numéro prend effet tout de suite. */
  bot: { name: string; status: string };
  /** Le numéro déjà branché : la fenêtre s'intitule « Changer de numéro » et le reconnaît dans la liste. */
  currentNumber: { id: number; phone_e164: string } | null;
  onClose: () => void;
  /** Branchement accepté par le moteur. */
  onDone: () => void;
}

type Listing = { phase: 'loading' } | { phase: 'failed' } | { phase: 'ready'; accounts: WhatsAppAccountView[] };

/** Choix du numéro d'un agent IA parmi ceux de l'organisation. Le moteur décide ; son refus s'affiche tel quel. */
export function AssignNumberDialog({ botId, bot, currentNumber, onClose, onDone }: Props) {
  const t = useTranslations('agentNumber.dialog');
  const ts = useTranslations('agents.status');
  const td = useTranslations('connections.dialogs');
  const hintId = useId();
  const keepsId = useId();
  const [listing, setListing] = useState<Listing>({ phase: 'loading' });
  const [numberId, setNumberId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Seule la dernière lecture compte ; une réponse arrivée après la fermeture est ignorée.
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    try {
      const res = await apiFetch('/api/whatsapp-accounts');
      if (await isOrgChanged(res)) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const accounts: unknown = await res.json();
      if (!Array.isArray(accounts)) throw new Error('réponse inattendue');
      if (mine === sequence.current) setListing({ phase: 'ready', accounts: accounts as WhatsAppAccountView[] });
    } catch (err: unknown) {
      console.error('[Agent] liste des numéros WhatsApp illisible', err);
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
  // Un numéro raccordé dans un autre onglet, ou pris entre-temps : la liste se relit au retour.
  useRefreshOnVisible(() => void load());

  const accounts = listing.phase === 'ready' ? listing.accounts : [];
  const selectable = selectableGroups(accounts).flatMap((group) => group.numbers);
  const hasChoice = numberId !== null && selectable.some((n) => n.id === numberId);
  const isEmpty = listing.phase === 'ready' && selectable.length === 0;
  const chosen = selectable.find((n) => n.id === numberId) ?? null;
  // Spec 2b §7.5 : le statut est conservé, le nouveau numéro sert tout de suite et l'ancien n'est plus servi.
  const keepsStatus = currentNumber !== null && chosen !== null && chosen.id !== currentNumber.id && isServingStatus(bot.status);
  const showHint = listing.phase === 'ready' && !isEmpty && !hasChoice;

  async function submit() {
    if (busyRef.current || !hasChoice || numberId === null) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    // Détenteur vu par l'écran : le moteur refuse (409) si le numéro a changé de main entre-temps (revue 2b-3 M-1).
    const body = { number_id: numberId, expected_bot_id: chosen?.bot?.bot_id ?? null };
    const result = await sendMutation(`/api/bots/${encodeURIComponent(botId)}/number`, 'PUT', body, td('failed'), 'Agent');
    busyRef.current = false;
    setBusy(false);
    if ('res' in result) {
      onDone();
      return;
    }
    if (result.orgChanged) return;
    setError(result.error);
    if (isHolderChanged(result)) {
      // La liste est relue et le choix à refaire : le nouveau détenteur est visible dans la liste avant la confirmation.
      setNumberId(null);
      void load();
    }
  }

  return (
    <DialogFrame title={currentNumber !== null ? t('titleChange') : t('titleAssign')} onClose={onClose}>
      <p className="mb-2.5 text-[13px] text-muted">{t('text')}</p>

      {listing.phase === 'loading' && <p className="text-[13px] text-muted-2" aria-busy="true">{t('loading')}</p>}

      {listing.phase === 'failed' && (
        <>
          <ErrorLine>{t('loadFailed')}</ErrorLine>
          <div className="mt-2">
            <CancelButton onClick={() => { setListing({ phase: 'loading' }); void load(); }}>{t('retry')}</CancelButton>
          </div>
        </>
      )}

      {isEmpty && (
        <div className="text-[13px] text-muted">
          <p>{t('empty')}</p>
          <Link href="/organisation/connexions/raccorder" className="mt-1.5 inline-block font-semibold underline">{t('connect')}</Link>
        </div>
      )}

      {listing.phase === 'ready' && !isEmpty && (
        <div className="max-h-[320px] overflow-auto">
          <NumberPicker accounts={accounts} selectedId={hasChoice ? numberId : null} currentBotId={botId} onSelect={setNumberId} />
        </div>
      )}

      {keepsStatus && chosen !== null && currentNumber !== null && (
        <p id={keepsId} role="status" className="mt-2.5 rounded-lg bg-warning-soft px-3 py-2 text-[12.5px] text-warning-ink">
          {t('keepsStatus', {
            bot: bot.name,
            status: ts(bot.status),
            number: formatPhone(chosen.phone_e164),
            old: formatPhone(currentNumber.phone_e164),
            audience: bot.status === 'active' ? 'active' : 'limited',
          })}
        </p>
      )}
      {showHint && <p id={hintId} className="mt-2 text-[12px] text-muted-2">{t('choose')}</p>}
      {error && <ErrorLine>{error}</ErrorLine>}

      <DialogActions>
        <CancelButton onClick={onClose}>{td('cancel')}</CancelButton>
        <PrimaryButton type="button" disabled={busy || !hasChoice} aria-describedby={showHint ? hintId : keepsStatus ? keepsId : undefined} onClick={() => void submit()}>
          {t('submit')}
        </PrimaryButton>
      </DialogActions>
    </DialogFrame>
  );
}
