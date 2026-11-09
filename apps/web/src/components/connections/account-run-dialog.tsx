'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountRefreshed, WhatsAppAccountVerified, WhatsAppAccountView } from '@wabagent/contracts';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { accountPath, engineCall } from './engine-call';
import { CancelButton, DialogActions, ErrorLine } from './dialog-ui';
import { InventorySummary } from './inventory-summary';
import { VerificationChecks } from './verification-checks';

export type RunKind = 'verify' | 'refresh';

type Run =
  | { phase: 'running' }
  | { phase: 'verified'; result: WhatsAppAccountVerified }
  | { phase: 'refreshed'; result: WhatsAppAccountRefreshed }
  | { phase: 'failed'; message: string };

interface Props {
  kind: RunKind;
  account: WhatsAppAccountView;
  onClose: () => void;
  /** Action menée à bout par le moteur (même si le résultat est un échec de vérification) : la page se relit. */
  onDone: () => void;
}

const ROUTE: Record<RunKind, string> = { verify: 'verify', refresh: 'refresh-numbers' };

/** « Vérifier maintenant » et « Rafraîchir les numéros » : l'action part à l'ouverture, le résultat s'affiche. */
export function AccountRunDialog({ kind, account, onClose, onDone }: Props) {
  const t = useTranslations(`connections.${kind}`);
  const td = useTranslations('connections.dialogs');
  const [run, setRun] = useState<Run>({ phase: 'running' });
  const started = useRef(false);
  const mounted = useRef(true);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const failedText = td('failed');

  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      void (async () => {
        const result = await engineCall<WhatsAppAccountVerified & WhatsAppAccountRefreshed>(
          `${accountPath(account.id)}/${ROUTE[kind]}`, 'POST', undefined, failedText, 'Connections',
        );
        if (result.kind === 'org_changed') return;
        // Un rafraîchissement refusé (422) peut avoir mis le compte en erreur (jeton refusé) : la page se relit aussi.
        if (result.kind === 'ok' || (kind === 'refresh' && result.failure.status === 422)) onDoneRef.current();
        if (!mounted.current) return;
        if (result.kind === 'refused') setRun({ phase: 'failed', message: result.failure.message });
        else if (result.data === null) setRun({ phase: 'failed', message: failedText });
        else if (kind === 'verify') setRun({ phase: 'verified', result: result.data });
        else setRun({ phase: 'refreshed', result: result.data });
      })();
    }
    return () => {
      mounted.current = false;
    };
  }, [account.id, kind, failedText]);

  return (
    <DialogFrame title={t('title')} onClose={onClose}>
      {run.phase === 'running' && <p className="mt-2 text-[13px] text-muted" aria-busy="true">{t('running')}</p>}
      {run.phase === 'failed' && <ErrorLine>{run.message}</ErrorLine>}
      {run.phase === 'verified' && <VerifyResult result={run.result} />}
      {run.phase === 'refreshed' && <InventorySummary inventory={run.result.inventory} />}
      <DialogActions>
        <CancelButton onClick={onClose}>{td('close')}</CancelButton>
      </DialogActions>
    </DialogFrame>
  );
}

function VerifyResult({ result }: { result: WhatsAppAccountVerified }) {
  const t = useTranslations('connections.verify');
  const checks = result.checks ?? [];
  // L'issue vient du moteur : aucune déduction depuis les contrôles (un refus peut avoir tous ses contrôles `ok`).
  const failed = result.outcome !== 'verified';
  const headline = t(result.outcome);
  return (
    <>
      <p role="status" className={`mt-2 text-[13px] font-semibold ${failed ? 'text-danger' : 'text-fg'}`}>{headline}</p>
      <VerificationChecks checks={checks} />
    </>
  );
}
