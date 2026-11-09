'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CreateWhatsAppAccountInput, type WhatsAppAccountCreated, type WhatsAppVerificationCheck } from '@wabagent/contracts';
import { Link } from '@/i18n/routing';
import { buttonVariants } from '@/components/ui/button';
import { readJsonBody, sendMutation, type MutationDetail } from '@/lib/api-fetch';
import { cn } from '@/lib/utils';
import { ConnectGuideCm } from './connect-guide-cm';
import { ConnectGuideMeta } from './connect-guide-meta';
import { ErrorLine, INPUT, LABEL, PrimaryButton } from './dialog-ui';
import { checksFromDetails, VerificationChecks } from './verification-checks';

type Mode = 'meta_manual' | 'cm_com';
type FieldName = 'name' | 'waba_id' | 'access_token' | 'app_secret' | 'account_id' | 'product_token';
type FieldErrors = Partial<Record<FieldName, string>>;

const CONNECTIONS_HREF = '/organisation/connexions';
const MODE_FIELDS: Record<Mode, readonly FieldName[]> = {
  meta_manual: ['name', 'waba_id', 'access_token', 'app_secret'],
  cm_com: ['name', 'account_id', 'product_token'],
};
const SECRET_FIELDS: ReadonlySet<FieldName> = new Set(['access_token', 'app_secret', 'product_token']);
const FIELD_LABEL: Record<FieldName, string> = {
  name: 'name',
  waba_id: 'wabaId',
  access_token: 'accessToken',
  app_secret: 'appSecret',
  account_id: 'cmAccountId',
  product_token: 'cmProductToken',
};
/** Message local (traduit) d'un champ refusé par le contrat : celui du contrat n'a pas de version anglaise. */
const FIELD_ERROR: Record<FieldName, string> = {
  name: 'name',
  waba_id: 'wabaId',
  access_token: 'accessToken',
  app_secret: 'appSecret',
  account_id: 'accountId',
  product_token: 'productToken',
};
const EMPTY: Record<FieldName, string> = { name: '', waba_id: '', access_token: '', app_secret: '', account_id: '', product_token: '' };

function isFieldName(value: unknown): value is FieldName {
  return typeof value === 'string' && value in EMPTY;
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink';

export function ConnectForm({ onCreated }: { onCreated: (account: WhatsAppAccountCreated) => void }) {
  const t = useTranslations('connections.connectFlow');
  const baseId = useId();
  const [mode, setMode] = useState<Mode>('meta_manual');
  const [values, setValues] = useState<Record<FieldName, string>>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<WhatsAppVerificationCheck[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const fieldId = (name: FieldName) => `${baseId}-${name}`;

  function selectMode(next: Mode) {
    setMode(next);
    // Aucun secret saisi dans un mode ne reste dans l'écran quand on passe à l'autre.
    setValues((v) => ({ ...v, access_token: '', app_secret: '', product_token: '' }));
    setErrors({});
    setError(null);
    setChecks([]);
  }

  /** Contrôle d'avant envoi par le schéma des contrats ; le moteur garde le dernier mot. */
  function validate(): { data: CreateWhatsAppAccountInput } | { errors: FieldErrors } {
    const body = { mode, ...Object.fromEntries(MODE_FIELDS[mode].map((n) => [n, values[n]])) };
    const parsed = CreateWhatsAppAccountInput.safeParse(body);
    if (parsed.success) return { data: parsed.data };
    const found: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (!isFieldName(field) || found[field]) continue;
      // Une valeur au-delà du maximum du contrat n'est pas « incomplète » (le nom a un message qui couvre les deux cas).
      const key = issue.code === 'too_big' && field !== 'name' ? 'tooLong' : FIELD_ERROR[field];
      found[field] = t(`errors.${key}`);
    }
    return { errors: Object.keys(found).length > 0 ? found : { name: t('errors.invalid') } };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    setError(null);
    setChecks([]);
    const checked = validate();
    if ('errors' in checked) {
      setErrors(checked.errors);
      const first = MODE_FIELDS[mode].find((n) => checked.errors[n]);
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    setErrors({});
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await sendMutation('/api/whatsapp-accounts', 'POST', checked.data, t('errors.failed'), 'Connections');
      if ('res' in result) {
        const created = await readJsonBody<WhatsAppAccountCreated>(result.res);
        if (!created) {
          setError(t('errors.failed'));
          return;
        }
        // Les secrets ne restent pas dans l'écran une fois le compte créé.
        setValues((v) => ({ ...v, access_token: '', app_secret: '', product_token: '' }));
        onCreated(created);
        return;
      }
      if (result.orgChanged) return;
      setError(result.error);
      if (result.status === 422) {
        // WA_VALIDATION_FAILED : les contrôles en échec sont dans `details` (clé du contrôle en `path`).
        setChecks(checksFromDetails(result.details));
      } else {
        setErrors(fieldErrors(result.details, MODE_FIELDS[mode]));
      }
    } finally {
      // Le verrou tient jusqu'à la fin de la lecture du corps de la réponse.
      busyRef.current = false;
      setBusy(false);
    }
  }

  function field(name: FieldName, hint?: string) {
    const id = fieldId(name);
    const describedBy = [hint ? `${id}-hint` : null, errors[name] ? `${id}-error` : null].filter(Boolean).join(' ');
    return (
      <div key={name} className="mt-3 first:mt-0">
        <label htmlFor={id} className={LABEL}>{t(`fields.${FIELD_LABEL[name]}`)}</label>
        <input
          id={id}
          value={values[name]}
          onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
          type={SECRET_FIELDS.has(name) ? 'password' : 'text'}
          // Un gestionnaire de mots de passe ne doit rien préremplir ni enregistrer ces valeurs.
          autoComplete={SECRET_FIELDS.has(name) ? 'new-password' : 'off'}
          spellCheck={false}
          aria-invalid={errors[name] ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(INPUT, FOCUS_RING, name !== 'name' && 'font-mono')}
        />
        {hint && <p id={`${id}-hint`} className="mt-1 text-[11.5px] text-muted-2">{hint}</p>}
        {errors[name] && <p id={`${id}-error`} className="mt-1 text-[12px] text-danger">{errors[name]}</p>}
      </div>
    );
  }

  const fields = MODE_FIELDS[mode].map((name) => field(name, name === 'waba_id' ? t('fields.wabaIdHint') : undefined));

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <p className="text-[13px] text-muted">{t('prerequisite')}</p>

      <div role="radiogroup" aria-label={t('modesLabel')} className="mt-4 grid gap-2.5 sm:grid-cols-3">
        <ModeCard id={`${baseId}-meta`} checked={mode === 'meta_manual'} onSelect={() => selectMode('meta_manual')} title={t('modes.meta.title')} text={t('modes.meta.text')} />
        <ModeCard id={`${baseId}-embedded`} checked={false} disabled badge={t('soon')} title={t('modes.embedded.title')} text={t('modes.embedded.text')} />
        <ModeCard id={`${baseId}-cm`} checked={mode === 'cm_com'} onSelect={() => selectMode('cm_com')} title={t('modes.cm.title')} text={t('modes.cm.text')} />
      </div>

      {mode === 'meta_manual' ? <ConnectGuideMeta>{fields}</ConnectGuideMeta> : <ConnectGuideCm>{fields}</ConnectGuideCm>}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-2">{t('footNote')}</span>
        <span className="flex gap-2">
          <Link href={CONNECTIONS_HREF} className={cn(buttonVariants({ variant: 'outline' }), 'h-auto border-border-strong px-[15px] py-2 text-[13px] font-normal')}>
            {t('cancel')}
          </Link>
          <PrimaryButton type="submit" disabled={busy}>{busy ? t('submitting') : t('submit')}</PrimaryButton>
        </span>
      </div>

      {error && <ErrorLine>{error}</ErrorLine>}
      {checks.length > 0 && <VerificationChecks checks={checks} />}
    </form>
  );
}

function fieldErrors(details: readonly MutationDetail[], names: readonly FieldName[]): FieldErrors {
  const out: FieldErrors = {};
  for (const d of details) {
    const field = names.find((n) => n === d.path);
    if (field && d.message) out[field] = d.message;
  }
  return out;
}

interface ModeCardProps {
  id: string;
  checked: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  badge?: string;
  title: string;
  text: string;
}

/** Carte de mode : bouton radio natif (flèches du clavier), une carte grisée ne se choisit pas et dit pourquoi. */
function ModeCard({ id, checked, onSelect, disabled, badge, title, text }: ModeCardProps) {
  return (
    <label
      className={cn(
        'block rounded-lg border px-3 py-2.5 text-[13px]',
        checked ? 'border-accent-ink bg-accent-soft' : !disabled && 'border-border bg-surface',
        // Carte grisée par le fond et la bordure seulement : le texte de la raison garde son contraste.
        disabled ? 'cursor-not-allowed border-dashed border-border bg-surface-subtle' : 'cursor-pointer hover:bg-surface-subtle',
        'focus-within:ring-2 focus-within:ring-accent-ink',
      )}
    >
      <input
        type="radio"
        name="connect-mode"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect?.()}
        aria-labelledby={`${id}-title`}
        aria-describedby={[`${id}-text`, badge ? `${id}-badge` : null].filter(Boolean).join(' ')}
      />
      <span className="flex items-center gap-2">
        <span id={`${id}-title`} className={cn('font-bold', disabled ? 'text-muted' : 'text-fg')}>{title}</span>
        {badge && (
          <span id={`${id}-badge`} className="rounded-pill bg-warning-soft px-2 py-px text-[11px] font-semibold text-warning-ink">{badge}</span>
        )}
      </span>
      <span id={`${id}-text`} className="mt-0.5 block text-xs text-muted-2">{text}</span>
    </label>
  );
}
