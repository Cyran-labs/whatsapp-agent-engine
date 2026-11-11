'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { Link } from '@/i18n/routing';
import { NumberPicker, choosableNumbers, selectableGroups } from '@/components/numbers/number-picker';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, isOrgChanged } from '@/lib/api-fetch';
import { useRefreshOnVisible } from '@/lib/use-refresh-on-visible';
import { StepCounter, WIZARD_PANE } from './stepper';
import { errorText } from '@/lib/error-text';

const CONNECT_HREF = '/organisation/connexions/raccorder';
/**
 * L'assistant ne branche le numéro qu'à l'activation de l'étape 5 (« Laisser en Draft » ne branche rien) : le numéro se
 * décide donc pour l'agent IA tel qu'il sera branché, en service (Preview, statut cible de l'activation). Un numéro d'un
 * compte en erreur ou retiré n'est pas choisissable, la raison des contrats sous le compte (Ruling T8 préoccupation 4 ;
 * Connexions et la page de l'agent IA décident avec le statut réel, Draft et Offline permis).
 */
const WIZARD_TARGET_STATUS = 'limited';
const PRIMARY = 'rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50';
const GHOST = 'rounded-xl border border-border-strong bg-surface px-5 py-3 font-semibold text-fg hover:bg-bg';
const LINK = 'font-semibold text-accent-ink underline-offset-2 hover:underline';

interface Props {
  /** Agent IA créé à l'étape 2 : son propre numéro, s'il en avait un, est reconnu dans la liste. */
  botId: string;
  numberId: number | null;
  /** `null` : le numéro retenu n'est plus proposé (retiré, compte déconnecté). */
  onChange: (numberId: number | null) => void;
  onBack: () => void;
  onNext: () => void;
  /** Termine l'assistant, l'agent IA reste en Draft. */
  onLater: () => void;
}

type Listing = { phase: 'loading' } | { phase: 'failed' } | { phase: 'ready'; accounts: WhatsAppAccountView[] };

/**
 * Étape 4 : choix du numéro. Elle ne fait que retenir le choix, rien n'est écrit dans le moteur :
 * le branchement a lieu à l'activation (étape 5), en une seule opération.
 */
export function StepNumber({ botId, numberId, onChange, onBack, onNext, onLater }: Props) {
  const t = useTranslations('wizard.number');
  const tw = useTranslations('wizard');
  const reasonId = useId();
  const wizardBot = { bot_id: botId, status: WIZARD_TARGET_STATUS };
  const [listing, setListing] = useState<Listing>({ phase: 'loading' });
  // Seule la dernière lecture compte ; une réponse arrivée après le démontage est ignorée.
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
      console.error('[Wizard] liste des numéros WhatsApp illisible', errorText(err));
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
  // Un compte raccordé dans l'autre onglet, ou un numéro pris entre-temps : la liste se relit au retour.
  useRefreshOnVisible(() => void load());

  const accounts = listing.phase === 'ready' ? listing.accounts : [];
  // Montrés : numéros présents des comptes non retirés ; choisissables : ceux que les contrats acceptent pour l'agent IA
  // tel que l'activation le branchera (`WIZARD_TARGET_STATUS`), donc jamais un numéro d'un compte en erreur.
  const shown = selectableGroups(accounts, wizardBot).length;
  const choosable = choosableNumbers(accounts, wizardBot);
  const hasChoice = numberId !== null && choosable.some((n) => n.id === numberId);
  const isEmpty = listing.phase === 'ready' && shown === 0;

  useEffect(() => {
    if (listing.phase === 'ready' && numberId !== null && !hasChoice) onChange(null);
  }, [listing.phase, numberId, hasChoice, onChange]);

  const reason =
    listing.phase === 'loading' ? t('loadingReason')
    : listing.phase === 'failed' ? t('failedReason')
    // Numéros montrés mais aucun choisissable (comptes en erreur) : relecture tâche 13, M-3.
    : choosable.length === 0 ? t('noUsableReason')
    : t('chooseReason');

  return (
    <div className={`${WIZARD_PANE} pb-12`}>
      <StepCounter step={4} />
      <h2 className="mt-1.5 font-serif text-2xl text-fg">{t('title')}</h2>
      <p className="mb-[18px] mt-1.5 text-muted">{t('lead')}</p>

      {listing.phase === 'loading' && (
        <div aria-busy="true">
          <p role="status" className="sr-only">{t('loading')}</p>
          {[0, 1, 2].map((row) => <Skeleton key={row} className="mb-[7px] h-[58px] w-full rounded-lg" />)}
        </div>
      )}

      {listing.phase === 'failed' && (
        <div className="rounded-xl border border-border bg-surface px-5 py-5 text-center">
          <p role="alert" className="text-danger">{t('loadFailed')}</p>
          <button
            type="button"
            onClick={() => {
              setListing({ phase: 'loading' });
              void load();
            }}
            className={`${GHOST} mt-3`}
          >
            {t('retry')}
          </button>
        </div>
      )}

      {isEmpty && (
        <>
          <div className="rounded-xl border border-dashed border-border-strong bg-surface px-[22px] py-[26px] text-center">
            <div aria-hidden="true" className="mx-auto mb-3 flex h-[46px] w-[46px] items-center justify-center rounded-lg bg-surface-subtle text-xl">⇄</div>
            <h3 className="font-serif text-lg text-fg">{t('emptyTitle')}</h3>
            <p className="mx-auto mb-4 mt-1 max-w-sm text-[13px] text-muted-2">{t('emptyText')}</p>
            <Link href={CONNECT_HREF} target="_blank" rel="noopener noreferrer" className={`${PRIMARY} inline-block`}>
              {t('emptyConnect')}
            </Link>
          </div>
          <p className="mt-3.5 text-center text-[12.5px] text-muted-2">
            {t.rich('emptyLater', {
              later: (chunks) => <button type="button" onClick={onLater} className={LINK}>{chunks}</button>,
            })}
          </p>
        </>
      )}

      {listing.phase === 'ready' && !isEmpty && (
        <>
          <NumberPicker accounts={accounts} selectedId={hasChoice ? numberId : null} currentBotId={botId} botStatus={WIZARD_TARGET_STATUS} onSelect={onChange} />
          <p className="mt-3.5 text-[12.5px] text-muted-2">
            <Link href={CONNECT_HREF} target="_blank" rel="noopener noreferrer" className={LINK}>
              {t('connectOther')}
            </Link>{' '}
            {t('connectOtherHint')}
          </p>
        </>
      )}

      <div className="mt-5 flex items-center justify-between">
        <button type="button" onClick={onBack} className="font-semibold text-muted hover:text-fg">← {t('back')}</button>
        {!isEmpty && (
          <span className="flex gap-2">
            <button type="button" onClick={onLater} className={GHOST}>{t('later')}</button>
            <button
              type="button"
              onClick={onNext}
              disabled={!hasChoice}
              aria-describedby={hasChoice ? undefined : reasonId}
              className={PRIMARY}
            >
              {tw('continue')}
            </button>
          </span>
        )}
      </div>
      {!isEmpty && !hasChoice && <p id={reasonId} className="mt-2 text-right text-[12.5px] text-muted">{reason}</p>}
    </div>
  );
}
