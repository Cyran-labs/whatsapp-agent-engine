'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountReplaced, WhatsAppAccountView } from '@wabagent/contracts';
import { InlineError } from '@/components/feedback/inline-error';
import { useDescribeFailure } from '@/components/feedback/use-describe-failure';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { readJsonBody, sendMutation } from '@/lib/api-fetch';
import { accountPath } from './account-path';
import { CancelButton, DialogActions, INPUT, LABEL, PrimaryButton } from './dialog-ui';
import { InventorySummary } from './inventory-summary';
import { checksFromDetails, refusedFieldsFromChecks, type ShownCheck, VerificationChecks } from './verification-checks';

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

export function ReplaceCredentialsDialog({ account, onClose, onDone }: Props) {
  const t = useTranslations('connections.credentials');
  const td = useTranslations('connections.dialogs');
  const tc = useTranslations('connections.checks');
  const describe = useDescribeFailure();
  const baseId = useId();
  const names = FIELDS[account.mode];
  // Aucun préremplissage : les secrets enregistrés ne sont jamais renvoyés par le moteur.
  const [values, setValues] = useState<Record<FieldName, string>>({
    waba_id: '', access_token: '', app_secret: '', account_id: '', product_token: '',
  });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<{ message: string; reference: string | null } | null>(null);
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
      else setError({ message: td('failed'), reference: null });
      return;
    }
    if (result.orgChanged) return;
    // 422 WA_VALIDATION_FAILED : les contrôles en échec sont dans `details` et restent tous dans la liste ; un contrôle
    // qui désigne un champ affiché (secret de l'app, jeton d'accès) marque en plus ce champ (audit des décisions A19).
    // Sinon (400) une erreur par champ.
    const verification = result.status === 422;
    const failure = verification ? describe(result, td('failed')) : describe(result, td('failed'), names);
    setError({ message: failure.message, reference: failure.reference });
    if (verification) {
      setChecks(checksFromDetails(result.details));
      const refused = refusedFieldsFromChecks(result.details, names);
      setErrors(Object.fromEntries(refused.map((n) => [n, tc('fieldRefused')])));
      if (refused[0]) document.getElementById(`${baseId}-${refused[0]}`)?.focus();
    } else {
      setErrors(failure.fieldErrors);
      // contre-audit D-3 (audit §5.1) : le focus va au premier champ refusé, dans l'ordre de l'écran.
      const first = names.find((n) => failure.fieldErrors[n]);
      if (first) document.getElementById(`${baseId}-${first}`)?.focus();
    }
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
        {error && (
          <div className="mt-2">
            <InlineError message={error.message} reference={error.reference} />
          </div>
        )}
        {checks.length > 0 && <VerificationChecks checks={checks} />}
        <DialogActions>
          <CancelButton busy={busy} onClick={onClose}>{td('cancel')}</CancelButton>
          <PrimaryButton type="submit" disabled={busy}>{t('submit')}</PrimaryButton>
        </DialogActions>
      </form>
    </DialogFrame>
  );
}
