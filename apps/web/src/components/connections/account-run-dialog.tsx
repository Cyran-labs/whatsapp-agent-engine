'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountRefreshed, WhatsAppAccountVerified, WhatsAppAccountView } from '@wabagent/contracts';
import { InlineError } from '@/components/feedback/inline-error';
import { useDescribeFailure } from '@/components/feedback/use-describe-failure';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { readJsonBody, sendMutation } from '@/lib/api-fetch';
import { accountPath } from './account-path';
import { CancelButton, DialogActions } from './dialog-ui';
import { InventorySummary } from './inventory-summary';
import { VerificationChecks } from './verification-checks';

export type RunKind = 'verify' | 'refresh';

type Run =
  | { phase: 'running' }
  | { phase: 'verified'; result: WhatsAppAccountVerified }
  | { phase: 'refreshed'; result: WhatsAppAccountRefreshed }
  | { phase: 'failed'; message: string; reference: string | null; replaceCredentials: boolean };

interface Props {
  kind: RunKind;
  account: WhatsAppAccountView;
  onClose: () => void;
  /** Action menée à bout par le moteur (même si le résultat est un échec de vérification) : la page se relit. */
  onDone: () => void;
  /** Ouvre la fenêtre « Remplacer les identifiants » du même compte (suite d'un jeton refusé à la lecture des numéros). */
  onReplaceCredentials?: () => void;
}

/** Fournisseur nommé dans le refus d'un jeton : le mode du compte, jamais un texte du moteur. */
const PROVIDER_NAME: Record<WhatsAppAccountView['mode'], string> = { meta_manual: 'Meta', cm_com: 'CM.com' };

const ROUTE: Record<RunKind, string> = { verify: 'verify', refresh: 'refresh-numbers' };

/** « Vérifier maintenant » et « Rafraîchir les numéros » : l'action part à l'ouverture, le résultat s'affiche. */
export function AccountRunDialog({ kind, account, onClose, onDone, onReplaceCredentials }: Props) {
  const t = useTranslations(`connections.${kind}`);
  const td = useTranslations('connections.dialogs');
  const tr = useTranslations('connections.refresh');
  const tm = useTranslations('connections.menu');
  const trRef = useRef(tr);
  trRef.current = tr;
  const provider = PROVIDER_NAME[account.mode];
  const describe = useDescribeFailure();
  const describeRef = useRef(describe);
  describeRef.current = describe;
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
        const result = await sendMutation(`${accountPath(account.id)}/${ROUTE[kind]}`, 'POST', undefined, failedText, 'Connections');
        if (!('res' in result) && result.orgChanged) return;
        // Un rafraîchissement refusé (422) peut avoir mis le compte en erreur (jeton refusé) : la page se relit aussi.
        if ('res' in result || (kind === 'refresh' && result.status === 422)) onDoneRef.current();
        const data = 'res' in result ? await readJsonBody<WhatsAppAccountVerified & WhatsAppAccountRefreshed>(result.res) : null;
        if (!mounted.current) return;
        if (!('res' in result)) {
          const failure = describeRef.current(result, failedText);
          // audit décisions B7 : jeton refusé à la lecture des numéros, le compte vient de passer en erreur ; la cause
          // et l'action (remplacer les identifiants) remplacent tout conseil de réessayer.
          const tokenRefused = result.reason === 'whatsapp_account.listing_token_invalid';
          setRun({
            phase: 'failed',
            message: tokenRefused ? trRef.current('tokenRefused', { provider }) : failure.message,
            reference: failure.reference,
            replaceCredentials: tokenRefused,
          });
        } else if (data === null) setRun({ phase: 'failed', message: failedText, reference: null, replaceCredentials: false });
        else if (kind === 'verify') setRun({ phase: 'verified', result: data });
        else setRun({ phase: 'refreshed', result: data });
      })();
    }
    return () => {
      mounted.current = false;
    };
  }, [account.id, kind, failedText, provider]);

  return (
    <DialogFrame title={t('title')} onClose={onClose} busy={run.phase === 'running'}>
      {run.phase === 'running' && <p className="mt-2 text-[13px] text-muted" aria-busy="true">{t('running')}</p>}
      {run.phase === 'failed' && (
        <div className="mt-2">
          <InlineError
            message={run.message}
            reference={run.reference}
            action={run.replaceCredentials && onReplaceCredentials ? (
              <button type="button" onClick={onReplaceCredentials} className="font-semibold text-fg underline">{tm('credentials')}</button>
            ) : undefined}
          />
        </div>
      )}
      {run.phase === 'verified' && <VerifyResult result={run.result} />}
      {run.phase === 'refreshed' && <InventorySummary inventory={run.result.inventory} />}
      <DialogActions>
        <CancelButton busy={run.phase === 'running'} onClick={onClose}>{td('close')}</CancelButton>
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
