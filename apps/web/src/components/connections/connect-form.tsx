'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BUSINESS_FOUND_DETAIL, CreateWhatsAppAccountInput, type WhatsAppAccountCreated } from '@wabagent/contracts';
import { Link } from '@/i18n/routing';
import { InlineError } from '@/components/feedback/inline-error';
import { useDescribeFailure } from '@/components/feedback/use-describe-failure';
import { ComingSoon, SoonBadge } from '@/components/shell/coming-soon';
import { buttonVariants } from '@/components/ui/button';
import { readJsonBody, sendMutation, type MutationFailure } from '@/lib/api-fetch';
import { businessIdFromInput, wabaIdFromInput } from '@/lib/meta-input';
import { cn } from '@/lib/utils';
import { BusinessStep } from './business-step';
import { ConnectGuideCm } from './connect-guide-cm';
import { ConnectGuideMeta } from './connect-guide-meta';
import { INPUT, LABEL, PrimaryButton } from './dialog-ui';
import type { GuidePath } from './guide-paths';
import { checksFromDetails, cleanupFromDetails, refusedFieldsFromChecks, type ShownCheck, VerificationChecks, WebhookCleanupNotice, type WebhookCleanup } from './verification-checks';

type Mode = 'meta_manual' | 'cm_com';
type FieldName = 'business_id' | 'name' | 'waba_id' | 'access_token' | 'app_secret' | 'account_id' | 'product_token';
/** Saisies rendues par `field()` ; le portefeuille a son étape à lui (`BusinessStep`). */
type PlainField = Exclude<FieldName, 'business_id'>;
type FieldErrors = Partial<Record<FieldName, string>>;

const CONNECTIONS_HREF = '/organisation/connexions';
const CM_FIELDS: readonly PlainField[] = ['name', 'account_id', 'product_token'];
/**
 * Saisies de chaque mode, dans l'ordre de l'écran (le focus va au premier champ refusé dans cet ordre). Meta (lot R2a,
 * spec R2a §5.1) : le portefeuille à l'étape 1, la WABA, le jeton et le secret dans leurs étapes, le nom en dernier.
 */
const MODE_FIELDS: Record<Mode, readonly FieldName[]> = {
  meta_manual: ['business_id', 'waba_id', 'access_token', 'app_secret', 'name'],
  cm_com: CM_FIELDS,
};
const SECRET_FIELDS: ReadonlySet<FieldName> = new Set(['access_token', 'app_secret', 'product_token']);
const FIELD_LABEL: Record<PlainField, string> = {
  name: 'name',
  waba_id: 'wabaId',
  access_token: 'accessToken',
  app_secret: 'appSecret',
  account_id: 'cmAccountId',
  product_token: 'cmProductToken',
};
/** Message local (traduit) d'un champ refusé par le contrat : celui du contrat n'a pas de version anglaise. */
const FIELD_ERROR: Record<FieldName, string> = {
  business_id: 'guideMeta.business.unrecognised',
  name: 'name',
  waba_id: 'wabaId',
  access_token: 'accessToken',
  app_secret: 'appSecret',
  account_id: 'accountId',
  product_token: 'productToken',
};
const EMPTY: Record<FieldName, string> = { business_id: '', name: '', waba_id: '', access_token: '', app_secret: '', account_id: '', product_token: '' };

function isFieldName(value: unknown): value is FieldName {
  return typeof value === 'string' && value in EMPTY;
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink';
const DIGITS_ONLY = /^[\d\s]*$/;

/**
 * Portefeuille lu chez Meta d'un refus `whatsapp_account.business_mismatch` (détail `business_found`, seul porteur de ce
 * détail, spec R2a §5.1, point 6), null si le refus n'en porte pas. Le texte de la raison se lit sans argument : l'écran
 * compose la phrase qui le nomme ; sans portefeuille lisible, le texte de la raison donné par `describeFailure` reste.
 */
function businessFound(failure: MutationFailure): { id: string; name: string } | null {
  return failure.details.find((d) => d.path === BUSINESS_FOUND_DETAIL)?.business ?? null;
}

export function ConnectForm({ onCreated }: { onCreated: (account: WhatsAppAccountCreated) => void }) {
  const t = useTranslations('connections.connectFlow');
  const tc = useTranslations('connections.checks');
  const describe = useDescribeFailure();
  const baseId = useId();
  const [mode, setMode] = useState<Mode>('meta_manual');
  const [values, setValues] = useState<Record<FieldName, string>>(EMPTY);
  // Chemin du guide Meta (spec R2a §5.1, point 3) : le premier par défaut, imposé quand l'adresse collée porte une WABA.
  const [path, setPath] = useState<GuidePath>('existing');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<{ message: string; reference: string | null } | null>(null);
  const [checks, setChecks] = useState<ShownCheck[]>([]);
  const [cleanup, setCleanup] = useState<WebhookCleanup | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // Zone d'erreur (message et contrôles) : sous le formulaire, souvent hors de l'écran. Un refus sans champ à focaliser
  // l'amène à l'écran et lui donne le focus (recette du 12 nov. 2026) ; chaque refus incrémente le compteur.
  const failureRef = useRef<HTMLDivElement>(null);
  const [failureShown, setFailureShown] = useState(0);
  useEffect(() => {
    if (failureShown === 0) return;
    const zone = failureRef.current;
    if (!zone) return;
    zone.scrollIntoView({ block: 'center' });
    zone.focus({ preventScroll: true });
  }, [failureShown]);

  const fieldId = (name: FieldName) => `${baseId}-${name}`;
  // Étape 1 (contrôle de forme) : la suite du guide reste grisée tant que le portefeuille n'est pas reconnu.
  const businessId = businessIdFromInput(values.business_id);
  const wabaId = wabaIdFromInput(values.waba_id);

  /**
   * Saisie de l'étape 1. Une adresse de WhatsApp Manager porte aussi la WABA (`asset_id`) : un nouveau `asset_id` remplit
   * le champ WABA (la saisie la plus récente l'emporte) et choisit le chemin 1 (spec R2a §5.1, point 2).
   */
  function changeBusiness(next: string) {
    const asset = businessIdFromInput(next) === null ? null : wabaIdFromInput(next);
    const previous = businessIdFromInput(values.business_id) === null ? null : wabaIdFromInput(values.business_id);
    const repick = asset !== null && !DIGITS_ONLY.test(next) && asset !== previous;
    setValues((v) => ({ ...v, business_id: next, ...(repick ? { waba_id: asset } : {}) }));
    setErrors((e) => {
      const rest = { ...e };
      delete rest.business_id;
      return rest;
    });
    if (repick) setPath('existing');
  }

  function selectMode(next: Mode) {
    setMode(next);
    // Aucun secret saisi dans un mode ne reste dans l'écran quand on passe à l'autre.
    setValues((v) => ({ ...v, access_token: '', app_secret: '', product_token: '' }));
    setErrors({});
    setError(null);
    setChecks([]);
  }

  /** Corps envoyé : pour Meta, le portefeuille reconnu et la WABA lue dans son champ (l'adresse donne `asset_id`). */
  function body(): Record<string, string> {
    if (mode === 'cm_com') return { mode, ...Object.fromEntries(MODE_FIELDS.cm_com.map((n) => [n, values[n]])) };
    return {
      mode, name: values.name, business_id: businessId ?? values.business_id, waba_id: wabaId ?? values.waba_id,
      access_token: values.access_token, app_secret: values.app_secret,
    };
  }

  /** Contrôle d'avant envoi par le schéma des contrats ; le moteur garde le dernier mot. */
  function validate(): { data: CreateWhatsAppAccountInput } | { errors: FieldErrors } {
    // Spec R2a §5.1 : l'étape du portefeuille est obligatoire dans le guide ; rien n'est envoyé sans elle.
    if (mode === 'meta_manual' && businessId === null) {
      const key = values.business_id.trim() === '' ? 'required' : 'unrecognised';
      return { errors: { business_id: t(`guideMeta.business.${key}`) } };
    }
    const parsed = CreateWhatsAppAccountInput.safeParse(body());
    if (parsed.success) return { data: parsed.data };
    const found: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (!isFieldName(field) || found[field]) continue;
      if (field === 'business_id') {
        found[field] = t(FIELD_ERROR.business_id);
        continue;
      }
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
    setCleanup(null);
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
          setError({ message: t('errors.failed'), reference: null });
          setFailureShown((n) => n + 1);
          return;
        }
        // Les secrets ne restent pas dans l'écran une fois le compte créé.
        setValues((v) => ({ ...v, access_token: '', app_secret: '', product_token: '' }));
        onCreated(created);
        return;
      }
      if (result.orgChanged) return;
      // Relecture finale R1 FR-I1 : bilan du retrait de l'adresse inscrite chez Meta, quel que soit le refus (422, 409
      // d'un raccordement concurrent, erreur interne d'un enregistrement en échec).
      setCleanup(cleanupFromDetails(result.details));
      if (result.status === 422) {
        // WA_VALIDATION_FAILED : les contrôles en échec sont dans `details` (clé du contrôle en `path`). La lecture du
        // refus ne reçoit aucun champ (la liste des contrôles reste entière) ; un contrôle qui désigne un champ affiché
        // (secret de l'app, jeton d'accès) marque en plus ce champ, focus sur le premier (audit des décisions A19).
        const failure = describe(result, t('errors.failed'));
        const found = businessFound(result);
        // Spec R2a §5.1, point 6 : le refus nomme le portefeuille lu chez Meta quand le moteur le donne.
        const message = found !== null ? t('errors.businessMismatch', { name: found.name, id: found.id }) : failure.message;
        setError({ message, reference: failure.reference });
        setChecks(checksFromDetails(result.details));
        const refused = refusedFieldsFromChecks(result.details, MODE_FIELDS[mode]);
        setErrors(Object.fromEntries(refused.map((n) => [n, tc('fieldRefused')])));
        if (refused[0]) document.getElementById(fieldId(refused[0]))?.focus();
        else setFailureShown((n) => n + 1);
      } else {
        const failure = describe(result, t('errors.failed'), MODE_FIELDS[mode]);
        setError({ message: failure.message, reference: failure.reference });
        setErrors(failure.fieldErrors);
        // contre-audit D-3 (audit §5.1) : le focus va au premier champ refusé, dans l'ordre de l'écran.
        const first = MODE_FIELDS[mode].find((n) => failure.fieldErrors[n]);
        if (first) document.getElementById(fieldId(first))?.focus();
        else setFailureShown((n) => n + 1);
      }
    } finally {
      // Le verrou tient jusqu'à la fin de la lecture du corps de la réponse.
      busyRef.current = false;
      setBusy(false);
    }
  }

  function field(name: PlainField, hint?: string) {
    const id = fieldId(name);
    // Spec R2a §5.1, point 5 : une adresse collée dans le champ WABA dit l'identifiant qu'elle donne.
    const read = name === 'waba_id' && wabaId !== null && !DIGITS_ONLY.test(values.waba_id) ? t('fields.wabaFromAddress', { waba: wabaId }) : null;
    const describedBy = [hint ? `${id}-hint` : null, read ? `${id}-read` : null, errors[name] ? `${id}-error` : null].filter(Boolean).join(' ');
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
        {hint && <p id={`${id}-hint`} className="mt-1 text-[11.5px] text-muted">{hint}</p>}
        {read && <p id={`${id}-read`} className="mt-1 text-[11.5px] text-accent-ink">{read}</p>}
        {errors[name] && <p id={`${id}-error`} className="mt-1 text-[12px] text-danger">{errors[name]}</p>}
      </div>
    );
  }

  const metaGuide = (
    <ConnectGuideMeta
      businessStep={<BusinessStep id={fieldId('business_id')} value={values.business_id} onChange={changeBusiness} error={errors.business_id ?? null} />}
      locked={businessId === null}
      path={path}
      onPathChange={setPath}
      businessId={businessId}
      wabaId={wabaId}
      fields={{
        waba: field('waba_id', t('fields.wabaIdHint')),
        token: field('access_token'),
        secret: field('app_secret'),
        name: field('name'),
      }}
    />
  );

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <p className="text-[13px] text-muted">{t('prerequisite')}</p>

      <div role="radiogroup" aria-label={t('modesLabel')} className="mt-4 grid gap-2.5 sm:grid-cols-3">
        <ModeCard id={`${baseId}-meta`} checked={mode === 'meta_manual'} onSelect={() => selectMode('meta_manual')} title={t('modes.meta.title')} text={t('modes.meta.text')} />
        <SoonModeCard title={t('modes.embedded.title')} text={t('modes.embedded.text')} tooltip={t('modes.embedded.soon')} />
        <ModeCard id={`${baseId}-cm`} checked={mode === 'cm_com'} onSelect={() => selectMode('cm_com')} title={t('modes.cm.title')} text={t('modes.cm.text')} />
      </div>

      {mode === 'meta_manual' ? metaGuide : <ConnectGuideCm>{CM_FIELDS.map((name) => field(name))}</ConnectGuideCm>}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-muted">{t('footNote')}</span>
        <span className="flex gap-2">
          <Link href={CONNECTIONS_HREF} className={cn(buttonVariants({ variant: 'outline' }), 'h-auto border-border-strong px-[15px] py-2 text-[13px] font-normal')}>
            {t('cancel')}
          </Link>
          <PrimaryButton type="submit" disabled={busy}>{busy ? t('submitting') : t('submit')}</PrimaryButton>
        </span>
      </div>

      {(error || checks.length > 0 || cleanup !== null) && (
        <div ref={failureRef} tabIndex={-1} data-connect-failure="" className={cn('scroll-mt-4 rounded-lg', FOCUS_RING)}>
          {error && (
            <div className="mt-2">
              <InlineError message={error.message} reference={error.reference} />
            </div>
          )}
          {checks.length > 0 && <VerificationChecks checks={checks} />}
          {cleanup !== null && <WebhookCleanupNotice cleanup={cleanup} />}
        </div>
      )}
    </form>
  );
}

interface ModeCardProps {
  id: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  text: string;
}

/**
 * Mode à venir (spec 5.4) : pas un bouton radio (il ne se choisit pas), un bloc grisé par le fond et la bordure,
 * pastille « Soon », bulle « Disponible prochainement : … » au survol et au focus. Le texte garde son contraste.
 */
function SoonModeCard({ title, text, tooltip }: { title: string; text: string; tooltip: string }) {
  return (
    <ComingSoon
      role="group"
      label={title}
      tooltip={tooltip}
      className="block h-full rounded-lg border border-dashed border-border bg-surface-subtle px-3 py-2.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
    >
      <span className="flex items-center gap-2">
        <span className="font-bold text-muted">{title}</span>
        <SoonBadge className="ml-auto" />
      </span>
      <span className="mt-0.5 block text-xs text-muted">{text}</span>
    </ComingSoon>
  );
}

/** Carte de mode : bouton radio natif (flèches du clavier). */
function ModeCard({ id, checked, onSelect, title, text }: ModeCardProps) {
  return (
    <label
      className={cn(
        'block cursor-pointer rounded-lg border px-3 py-2.5 text-[13px] hover:bg-surface-subtle',
        checked ? 'border-accent-ink bg-accent-soft' : 'border-border bg-surface',
        'focus-within:ring-2 focus-within:ring-accent-ink',
      )}
    >
      <input
        type="radio"
        name="connect-mode"
        className="sr-only"
        checked={checked}
        onChange={onSelect}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-text`}
      />
      <span id={`${id}-title`} className="font-bold text-fg">{title}</span>
      <span id={`${id}-text`} className="mt-0.5 block text-xs text-muted">{text}</span>
    </label>
  );
}
