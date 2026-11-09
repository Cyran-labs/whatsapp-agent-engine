'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountReplaced, WhatsAppAccountView } from '@wabagent/contracts';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { readJsonBody, sendMutation, type MutationDetail } from '@/lib/api-fetch';
import { accountPath } from './account-path';
import { CancelButton, DialogActions, ErrorLine, INPUT, LABEL, PrimaryButton } from './dialog-ui';
import { InventorySummary } from './inventory-summary';
import { checksFromDetails, type ShownCheck, VerificationChecks } from './verification-checks';

interface Props {
  account: WhatsAppAccountView;
  onClose: () => void;
  /** Identifiants remplacés et compte revérifié : la page se relit, la fenêtre reste ouverte sur le résultat. */
  onDone: () => void;
}

type FieldName = 'waba_id' | 'access_token' | 'app_secret' | 'account_id' | 'product_token';

const FIELDS: Record<WhatsAppAccountView['mode'], readonly FieldName[]> = {
  meta_manual: ['waba_id', 'access_token', 'app_secret'],
  cm_com: ['account_id', 'product_token'],
};
const SECRET_FIELDS: ReadonlySet<FieldName> = new Set(['access_token', 'app_secret', 'product_token']);
const FIELD_LABEL: Record<FieldName, string> = {
  waba_id: 'wabaId',
  access_token: 'accessToken',
  app_secret: 'appSecret',
  account_id: 'cmAccountId',
  product_token: 'cmProductToken',
};

function fieldErrors(details: readonly MutationDetail[], names: readonly FieldName[]): Partial<Record<FieldName, string>> {
  const out: Partial<Record<FieldName, string>> = {};
  for (const d of details) {
    const field = names.find((n) => n === d.path);
    if (field && d.message) out[field] = d.message;
  }
  return out;
}

export function ReplaceCredentialsDialog({ account, onClose, onDone }: Props) {
  const t = useTranslations('connections.credentials');
  const td = useTranslations('connections.dialogs');
  const baseId = useId();
  const names = FIELDS[account.mode];
  // Aucun préremplissage : les secrets enregistrés ne sont jamais renvoyés par le moteur.
  const [values, setValues] = useState<Record<FieldName, string>>({
    waba_id: '', access_token: '', app_secret: '', account_id: '', product_token: '',
  });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<ShownCheck[]>([]);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [done, setDone] = useState<WhatsAppAccountReplaced | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setChecks([]);
    setErrors({});
    const body = { mode: account.mode, ...Object.fromEntries(names.map((n) => [n, values[n]])) };
    const result = await sendMutation(`${accountPath(account.id)}/credentials`, 'PUT', body, td('failed'), 'Connections');
    busyRef.current = false;
    setBusy(false);
    if ('res' in result) {
      onDone();
      const created = await readJsonBody<WhatsAppAccountReplaced>(result.res);
      if (created) setDone(created);
      else setError(td('failed'));
      return;
    }
    if (result.orgChanged) return;
    setError(result.error);
    // 422 WA_VALIDATION_FAILED : les contrôles en échec sont dans `details` ; 400 : une erreur par champ.
    if (result.status === 422) setChecks(checksFromDetails(result.details));
    setErrors(fieldErrors(result.details, names));
  }

  if (done) {
    return (
      <DialogFrame title={t('title')} onClose={onClose} busy={busy}>
        <p role="status" className="mt-2 text-[13px] font-semibold">{t('done')}</p>
        <VerificationChecks checks={done.checks ?? []} />
        <InventorySummary inventory={done.inventory} />
        <DialogActions>
          <CancelButton onClick={onClose}>{td('close')}</CancelButton>
        </DialogActions>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame title={t('title')} onClose={onClose} busy={busy}>
      <form onSubmit={(e) => void submit(e)}>
        <p className="mb-1 text-[13px] text-muted">{account.mode === 'meta_manual' ? t('introMeta') : t('introCm')}</p>
        {names.map((name) => {
          const id = `${baseId}-${name}`;
          const hint = name === 'waba_id' || name === 'account_id' ? t('sameAccount', { id: account.provider_account_id }) : null;
          const describedBy = [hint ? `${id}-hint` : null, errors[name] ? `${id}-error` : null].filter(Boolean).join(' ');
          return (
            <div key={name}>
              <label htmlFor={id} className={`${LABEL} mt-3`}>{t(FIELD_LABEL[name])}</label>
              <input
                id={id}
                value={values[name]}
                onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                type={SECRET_FIELDS.has(name) ? 'password' : 'text'}
                // Un gestionnaire de mots de passe ne doit rien préremplir : les secrets enregistrés ne sont jamais renvoyés.
                autoComplete={SECRET_FIELDS.has(name) ? 'new-password' : 'off'}
                spellCheck={false}
                aria-invalid={errors[name] ? true : undefined}
                aria-describedby={describedBy || undefined}
                className={INPUT}
              />
              {hint && <p id={`${id}-hint`} className="mt-1 text-[11.5px] text-muted">{hint}</p>}
              {errors[name] && <p id={`${id}-error`} className="mt-1 text-[12px] text-danger">{errors[name]}</p>}
            </div>
          );
        })}
        {error && <ErrorLine>{error}</ErrorLine>}
        {checks.length > 0 && <VerificationChecks checks={checks} />}
        <DialogActions>
          <CancelButton busy={busy} onClick={onClose}>{td('cancel')}</CancelButton>
          <PrimaryButton type="submit" disabled={busy}>{t('submit')}</PrimaryButton>
        </DialogActions>
      </form>
    </DialogFrame>
  );
}
