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
  // État du compte à l'ouverture : la page se relit après la vérification, la prop `account` peut alors changer.
  const [wasInError] = useState(account.state === 'error');
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
      {run.phase === 'verified' && <VerifyResult result={run.result} wasInError={wasInError} />}
      {run.phase === 'refreshed' && <InventorySummary inventory={run.result.inventory} />}
      <DialogActions>
        <CancelButton busy={run.phase === 'running'} onClick={onClose}>{td('close')}</CancelButton>
      </DialogActions>
    </DialogFrame>
  );
}

function VerifyResult({ result, wasInError }: { result: WhatsAppAccountVerified; wasInError: boolean }) {
  const t = useTranslations('connections.verify');
  const tr = useTranslations();
  const checks = result.checks ?? [];
  // Audit des décisions R1 P-11 : issue non concluante que réessayer ne corrige pas (plateforme sans adresse publique). Le
  // titre ne dit pas « Réessayez » et la cause est dite par sa clé ; les contrôles ne font que la répéter.
  const reasonKey = result.reason === undefined ? null : `errors.reasons.${result.reason}`;
  if (result.outcome === 'inconclusive' && reasonKey !== null && tr.has(reasonKey)) {
    return (
      <>
        <p role="status" className="mt-2 text-[13px] font-semibold text-danger">{t('unavailable')}</p>
        <p className="mt-1.5 text-[13px] text-fg">{tr(reasonKey)}</p>
      </>
    );
  }
  // L'issue vient du moteur : aucune déduction depuis les contrôles (un refus peut avoir tous ses contrôles `ok`).
  const failed = result.outcome !== 'verified';
  // Relecture finale R1 FR-I2 : identifiants vérifiés (issue du moteur) mais un contrôle de webhook en échec ; le titre ne
  // dit pas « réussie », sans dire non plus que le compte est en erreur. Audit des décisions R1, F-3 : un seul titre prudent
  // (« webhook à contrôler chez Meta »), la cause pouvant être autre qu'une inscription refusée.
  const webhookMissing = result.outcome === 'verified'
    && checks.some((c) => (c.key === 'webhook_waba' || c.key === 'webhook_app') && c.status === 'failed');
  // Revue de la tâche 19 : un compte déjà en erreur avant la vérification y reste, il n'y « passe » pas.
  const headline = webhookMissing
    ? t('verifiedWebhookMissing')
    : result.outcome === 'refused' && wasInError ? t('refusedStillError') : t(result.outcome);
  const tone = failed ? 'text-danger' : webhookMissing ? 'text-warning-ink' : 'text-fg';
  return (
    <>
      <p role="status" className={`mt-2 text-[13px] font-semibold ${tone}`}>{headline}</p>
      <VerificationChecks checks={checks} />
    </>
  );
}
