'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { Link } from '@/i18n/routing';
import { NumberPicker, selectableGroups } from '@/components/numbers/number-picker';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, isOrgChanged } from '@/lib/api-fetch';
import { StepCounter, WIZARD_PANE } from './stepper';

const CONNECT_HREF = '/organisation/connexions/raccorder';
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
  /** Termine l'assistant, l'agent IA reste en brouillon. */
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
      console.error('[Wizard] liste des numéros WhatsApp illisible', err);
      // Une relecture en échec garde la liste déjà affichée.
      if (mine === sequence.current) setListing((previous) => (previous.phase === 'ready' ? previous : { phase: 'failed' }));
    }
  }, []);

  useEffect(() => {
    void load();
    // Un compte raccordé dans l'autre onglet, ou un numéro pris entre-temps : la liste se relit au retour.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      sequence.current += 1;
    };
  }, [load]);

  const accounts = listing.phase === 'ready' ? listing.accounts : [];
  const selectable = selectableGroups(accounts).flatMap((group) => group.numbers);
  const hasChoice = numberId !== null && selectable.some((n) => n.id === numberId);
  const isEmpty = listing.phase === 'ready' && selectable.length === 0;

  useEffect(() => {
    if (listing.phase === 'ready' && numberId !== null && !hasChoice) onChange(null);
  }, [listing.phase, numberId, hasChoice, onChange]);

  const reason = listing.phase === 'loading' ? t('loadingReason') : listing.phase === 'failed' ? t('failedReason') : t('chooseReason');

  return (
    <div className={`${WIZARD_PANE} pb-12`}>
      <StepCounter step={4} centered />
      <h1 className="mt-1.5 text-center font-serif text-2xl text-fg">{t('title')}</h1>
      <p className="mb-[18px] mt-1.5 text-center text-muted">{t('lead')}</p>

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
            <h2 className="font-serif text-lg text-fg">{t('emptyTitle')}</h2>
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
          <NumberPicker accounts={accounts} selectedId={hasChoice ? numberId : null} currentBotId={botId} onSelect={onChange} />
          <p className="mt-3.5 text-center text-[12.5px] text-muted-2">
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
      {!isEmpty && !hasChoice && <p id={reasonId} className="mt-2 text-right text-[12.5px] text-muted-2">{reason}</p>}
    </div>
  );
}
