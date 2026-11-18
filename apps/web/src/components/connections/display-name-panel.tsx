'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DISPLAY_NAME_MAX, metaLinks, type WhatsAppAccountView, type WhatsAppNumberView } from '@wabagent/contracts';
import { InlineError } from '@/components/feedback/inline-error';
import { useDescribeFailure } from '@/components/feedback/use-describe-failure';
import { readJsonBody, sendMutation, type MutationFailure } from '@/lib/api-fetch';
import type { DescribedFailure } from '@/lib/describe-failure';
import { parseEngineDate } from '@/lib/engine-date';
import { useMediumDate } from '@/lib/medium-date';
import { accountPath } from './account-path';
import { applyDeadlinePassed } from './display-name-deadline';
import { CancelButton, INPUT, LABEL, PrimaryButton } from './dialog-ui';
import { codePoints } from './profile-draft';
import { ProviderTextDetail } from './provider-text';

/** Règles de Meta pour le nom d'affichage (à vérifier en recette). */
export const DISPLAY_NAME_RULES_URL = 'https://www.facebook.com/business/help/757569725593362';

const CODE = /^\d{6}$/;
const LINK = 'font-semibold underline';

type Tone = 'ok' | 'warning' | 'danger';
const TAG: Record<Tone, string> = {
  ok: 'bg-success-soft text-success-ink',
  warning: 'bg-warning-soft text-warning-ink',
  danger: 'bg-danger-soft text-danger-ink',
};

export function NameTag({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`rounded-pill px-[7px] py-0.5 text-[10.5px] font-bold ${TAG[tone]}`}>{children}</span>;
}

/** Refus restitué d'une action du nom : texte lu par `describeFailure`, texte de Meta replié quand le moteur le porte. */
interface ShownFailure {
  described: DescribedFailure;
  providerText: string | null;
  /** Code refusé par Meta : le refus propose de changer le code dans WhatsApp Manager. */
  pinRejected: boolean;
}

function providerTextOf(failure: MutationFailure): string | null {
  return failure.details.find((d) => d.provider_text !== undefined)?.provider_text ?? null;
}

interface Props {
  account: WhatsAppAccountView;
  number: WhatsAppNumberView;
  /** Vue du numéro relue par le moteur après une demande ou une application réussie. */
  onNumberChanged: (number: WhatsAppNumberView) => void;
  /** Envoi en cours : la fenêtre ne se ferme pas pendant l'appel. */
  onBusyChange: (busy: boolean) => void;
}

/**
 * Encart « Nom affiché » de la fenêtre du profil (spec R2a §5.3 et §13.2, maquette 04 partie 3), à quatre états : aucune
 * demande (nom affiché, « Approuvé »), en revue, refusé, approuvé à appliquer. Le nom affiché est toujours
 * `display_name` : un nom demandé ou approuvé n'est jamais présenté comme affiché.
 *
 * Le code de vérification en deux étapes ne vit que dans l'état de ce composant : jamais dans `sessionStorage`, l'adresse
 * ou un état gardé, ni proposé au gestionnaire de mots de passe (champ texte masqué par CSS, `one-time-code`), et il est
 * vidé après chaque réponse du moteur, réussie ou non.
 */
export function DisplayNamePanel({ account, number, onNumberChanged, onBusyChange }: Props) {
  const t = useTranslations('connections.displayName');
  const mediumDate = useMediumDate();
  const describe = useDescribeFailure();
  const baseId = useId();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [code, setCode] = useState('');
  const [codeInvalid, setCodeInvalid] = useState(false);
  // Audit P-46 (décision de François du 18 nov. 2026) : code masqué par défaut, visible d'office sans code actif (à noter).
  const [codeShownChoice, setCodeShownChoice] = useState<boolean | null>(null);
  const codeShown = codeShownChoice ?? number.pin_enabled === false;
  const [expired, setExpired] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<ShownFailure | null>(null);
  const [notice, setNotice] = useState<'requested' | 'applied' | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const busyChange = useRef(onBusyChange);
  busyChange.current = onBusyChange;

  useEffect(() => {
    busyChange.current(busy);
  }, [busy]);
  useEffect(() => {
    if (requesting) nameRef.current?.focus();
  }, [requesting]);

  const managerUrl = metaLinks({ business_id: account.business?.id ?? null, waba_id: account.waba_id }).phoneNumbers.url;
  const date = (iso: string | null): string | null => {
    const parsed = parseEngineDate(iso);
    return parsed === null ? null : mediumDate(parsed);
  };
  // Délai dépassé (refus `name_apply_expired`) : l'encart repasse à « Demander un autre nom » (spec R2a §5.3, point 4).
  const request = expired ? null : number.display_name_request;
  // Date limite passée à la date du navigateur (ruling R-31) : l'encart le dit, mais garde le code et « Appliquer » à côté
  // d'une nouvelle demande, puisque c'est le refus de Meta qui tranche (spec R2a §6.3, audit P-49).
  const deadlinePassed = applyDeadlinePassed(request, new Date());
  const base = `${accountPath(account.id)}/numbers/${number.id}/display-name`;

  function start() {
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    setNotice(null);
  }

  function stop() {
    busyRef.current = false;
    setBusy(false);
  }

  async function apply() {
    if (busyRef.current) return;
    if (!CODE.test(code)) {
      setCodeInvalid(true);
      codeRef.current?.focus();
      return;
    }
    setCodeInvalid(false);
    start();
    const result = await sendMutation(`${base}/apply`, 'POST', { pin: code }, t('applyFailed'), 'Connections');
    // Vidé après chaque réponse : le code n'est jamais gardé.
    setCode('');
    stop();
    if ('res' in result) {
      const view = await readJsonBody<WhatsAppNumberView>(result.res);
      setNotice('applied');
      if (view !== null) onNumberChanged(view);
      return;
    }
    if (result.orgChanged) return;
    if (result.reason === 'whatsapp_account.name_apply_expired') setExpired(true);
    setFailure({
      described: describe(result, t('applyFailed')),
      providerText: providerTextOf(result),
      pinRejected: result.reason === 'whatsapp_account.pin_rejected',
    });
  }

  function openRequest() {
    setRequesting(true);
    setNewName('');
    setNameError(null);
    setFailure(null);
    setNotice(null);
  }

  async function sendRequest() {
    if (busyRef.current) return;
    const name = newName.trim();
    const localError = name === '' ? t('nameEmpty') : codePoints(name) > DISPLAY_NAME_MAX ? t('tooLong', { max: DISPLAY_NAME_MAX }) : null;
    if (localError !== null) {
      setNameError(localError);
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    start();
    const result = await sendMutation(base, 'POST', { new_display_name: name }, t('requestFailed'), 'Connections');
    stop();
    if ('res' in result) {
      const view = await readJsonBody<WhatsAppNumberView>(result.res);
      setRequesting(false);
      setExpired(false);
      setNotice('requested');
      if (view !== null) onNumberChanged(view);
      return;
    }
    if (result.orgChanged) return;
    const described = describe(result, t('requestFailed'), ['new_display_name']);
    const own = described.fieldErrors['new_display_name'];
    if (own !== undefined) {
      setNameError(own);
      nameRef.current?.focus();
      return;
    }
    setFailure({ described, providerText: providerTextOf(result), pinRejected: false });
  }

  const requestButton = (
    <CancelButton busy={busy} onClick={openRequest}>{t('request')}</CancelButton>
  );

  let tag: React.ReactNode;
  let body: React.ReactNode;
  let action: React.ReactNode = null;
  if (request === null) {
    tag = <NameTag tone="ok">{t('approved')}</NameTag>;
    body = <p>{t('limit')}</p>;
    if (!requesting) action = requestButton;
  } else if (request.status === 'in_review') {
    const requestedOn = date(request.requested_at);
    tag = <NameTag tone="warning">{t('inReview')}</NameTag>;
    body = (
      <p>
        {requestedOn !== null ? t('inReviewText', { date: requestedOn, name: request.requested_name }) : t('inReviewTextUndated', { name: request.requested_name })}{' '}
        {t('inReviewHint')}
      </p>
    );
  } else if (request.status === 'rejected') {
    tag = <NameTag tone="danger">{t('rejected')}</NameTag>;
    body = (
      <>
        <p>{t('rejectedText', { name: request.requested_name })}</p>
        {request.rejection_reason !== null && <p className="mt-1">{t('rejectedReason', { reason: request.rejection_reason })}</p>}
        <p className="mt-1.5">
          <a href={DISPLAY_NAME_RULES_URL} target="_blank" rel="noopener noreferrer" className={LINK}>{t('rules')}</a>
        </p>
      </>
    );
    if (!requesting) action = requestButton;
  } else if (request.status === 'expired') {
    // Audit P-42 : trace du moteur, demande approuvée disparue chez Meta sans être appliquée.
    tag = <NameTag tone="danger">{t('expired')}</NameTag>;
    body = <p>{t('expiredText', { name: request.requested_name })}</p>;
    if (!requesting) action = requestButton;
  } else {
    const approvedOn = date(request.approved_at);
    const deadline = date(request.apply_before);
    tag = <NameTag tone="warning">{deadlinePassed ? t('approvedPendingLate') : t('approvedPending')}</NameTag>;
    body = (
      <p>
        {approvedOn !== null ? t('approvedText', { name: request.requested_name, date: approvedOn }) : t('approvedTextUndated', { name: request.requested_name })}
        {deadlinePassed
          ? <> {t('probablyExpired')}</>
          : deadline !== null && <> {request.apply_before_approx ? t('applyBeforeApprox', { date: deadline }) : t('applyBefore', { date: deadline })}</>}
      </p>
    );
    if (deadlinePassed && !requesting) action = requestButton;
  }

  const codeId = `${baseId}-code`;
  const codeHelpId = `${baseId}-code-help`;
  const codeErrorId = `${baseId}-code-error`;
  const nameId = `${baseId}-name`;
  const nameHelpId = `${baseId}-name-help`;
  const nameErrorId = `${baseId}-name-error`;
  const titleId = `${baseId}-title`;

  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-border bg-surface px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h5 id={titleId} className="text-[11.5px] font-semibold text-muted">{t('label')}</h5>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <b className="break-words text-[14px]">{number.display_name}</b>
            {tag}
          </div>
        </div>
        {action}
      </div>
      <div className="mt-1.5 text-[12.5px] text-muted">{body}</div>

      {request?.status === 'approved_pending' && (
        <div className="mt-3">
          <label htmlFor={codeId} className={LABEL}>{t('code')}</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={codeRef}
              id={codeId}
              // Ruling R-28 : jamais `password`, pour que le navigateur ne propose pas de le garder dans son gestionnaire de mots
              // de passe. Audit P-46 : le masquage est fait par CSS (`-webkit-text-security`), levé par « Afficher ».
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              value={code}
              disabled={busy}
              aria-invalid={codeInvalid || undefined}
              aria-describedby={codeInvalid ? `${codeErrorId} ${codeHelpId}` : codeHelpId}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setCodeInvalid(false);
              }}
              className={`${INPUT} max-w-[160px] font-mono tracking-[0.3em] ${codeShown ? '' : '[-webkit-text-security:disc]'}`}
            />
            <button
              type="button"
              aria-controls={codeId}
              aria-pressed={codeShown}
              onClick={() => setCodeShownChoice(!codeShown)}
              className="rounded-md px-1.5 py-1 text-[12.5px] font-semibold text-accent-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
            >
              {codeShown ? t('codeHide') : t('codeShow')}
            </button>
          </div>
          {codeInvalid && <p id={codeErrorId} className="mt-1 text-[12.5px] text-danger">{t('codeInvalid')}</p>}
          <p id={codeHelpId} className="mt-1 text-[12px] text-muted">
            {number.pin_enabled === false
              ? t('codeHelpNoCode')
              : t.rich('codeHelp', {
                link: (chunks) => <a href={managerUrl} target="_blank" rel="noopener noreferrer" className={LINK}>{chunks}</a>,
              })}
          </p>
          <div className="mt-2.5">
            <PrimaryButton type="button" disabled={busy} onClick={() => void apply()}>{t('apply')}</PrimaryButton>
          </div>
        </div>
      )}

      {requesting && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={nameId} className={LABEL}>{t('newName')}</label>
            <span className={`text-[11.5px] ${codePoints(newName) > DISPLAY_NAME_MAX ? 'text-danger' : 'text-muted'}`}>
              {codePoints(newName)} / {DISPLAY_NAME_MAX}
            </span>
          </div>
          <input
            ref={nameRef}
            id={nameId}
            type="text"
            value={newName}
            disabled={busy}
            aria-invalid={nameError !== null || undefined}
            aria-describedby={nameError !== null ? `${nameErrorId} ${nameHelpId}` : nameHelpId}
            onChange={(e) => {
              setNewName(e.target.value);
              setNameError(null);
            }}
            className={INPUT}
          />
          {nameError !== null && <p id={nameErrorId} className="mt-1 text-[12.5px] text-danger">{nameError}</p>}
          <p id={nameHelpId} className="mt-1 text-[12px] text-muted">{t('requestHint')}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <CancelButton busy={busy} onClick={() => { setRequesting(false); setNameError(null); setFailure(null); }}>{t('cancel')}</CancelButton>
            <PrimaryButton type="button" disabled={busy} onClick={() => void sendRequest()}>{t('send')}</PrimaryButton>
          </div>
        </div>
      )}

      {failure !== null && (
        <div className="mt-2.5">
          <InlineError
            message={failure.described.message}
            reference={failure.described.reference}
            action={failure.pinRejected ? <a href={managerUrl} target="_blank" rel="noopener noreferrer" className={LINK}>{t('changeCode')}</a> : undefined}
          />
          {failure.providerText !== null && <ProviderTextDetail text={failure.providerText} />}
        </div>
      )}
      {notice !== null && (
        <p role="status" className="mt-2.5 text-[12.5px] font-semibold text-success-ink">{notice === 'applied' ? t('applied') : t('requested')}</p>
      )}
    </section>
  );
}
