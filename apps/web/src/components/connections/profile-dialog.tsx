'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BUSINESS_PROFILE_LIMITS, PROFILE_PHOTO_MAX_BYTES, PROFILE_PHOTO_TYPES, WHATSAPP_VERTICALS,
  type WhatsAppAccountView, type WhatsAppBusinessProfileView, type WhatsAppNumberView,
} from '@wabagent/contracts';
import { InlineError } from '@/components/feedback/inline-error';
import { useDescribeFailure } from '@/components/feedback/use-describe-failure';
import { DialogFrame } from '@/components/organisation/dialog-frame';
import { Skeleton } from '@/components/ui/skeleton';
import { readJsonBody, sendFile, sendMutation, type MutationFailure } from '@/lib/api-fetch';
import type { DescribedFailure } from '@/lib/describe-failure';
import { parseEngineDate } from '@/lib/engine-date';
import { useMediumDate } from '@/lib/medium-date';
import { formatPhone } from '@/lib/whatsapp-display';
import { accountPath } from './account-path';
import { CancelButton, DialogActions, INPUT, LABEL, PrimaryButton } from './dialog-ui';
import { DisplayNamePanel } from './display-name-panel';
import {
  blockingErrors, changedFields, codePoints, draftErrors, draftOf, PROFILE_FIELD_PATHS,
  type DraftError, type ProfileDraft, type ProfileFieldPath, type ProfileTextField,
} from './profile-draft';
import { ProfileAvatar, ProfilePreview } from './profile-preview';
import { ProviderTextDetail } from './provider-text';

const SAVED_UNREAD = 'whatsapp_account.profile_saved_unread';
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink';
/**
 * Ton d'un avis (`role="status"`) : réussite, rien à faire, ou avertissement (`profile_saved_unread`), jamais celui d'une
 * erreur. L'avertissement est posé sur son fond ambre doux, comme les autres avertissements : l'encre seule sur la surface
 * sombre n'est pas lisible (revue finale M-c).
 */
const NOTICE_TONE = {
  success: 'text-success-ink',
  neutral: 'text-muted',
  warning: 'rounded-lg bg-warning-soft px-3 py-2 text-warning-ink',
} as const;

interface Ready {
  /** Version lue chez Meta : les champs modifiés se comptent par rapport à elle. */
  baseline: ProfileDraft;
  draft: ProfileDraft;
  photoUrl: string | null;
  readAt: string;
}

type Reading = { phase: 'loading' } | { phase: 'failed'; failure: ShownFailure } | { phase: 'ready' };

interface ShownFailure {
  described: DescribedFailure;
  providerText: string | null;
}

/** `text` : avis `profile_saved_unread` (ruling R-17), en ton d'avertissement (Ruling R-28). */
type Notice = { kind: 'saved' } | { kind: 'noChange' } | { kind: 'text'; text: string };

function isProfile(value: unknown): value is WhatsAppBusinessProfileView {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    ['about', 'description', 'address', 'email', 'vertical', 'read_at'].every((k) => typeof v[k] === 'string') &&
    Array.isArray(v.websites) && v.websites.every((w) => typeof w === 'string') &&
    (v.photo_url === null || typeof v.photo_url === 'string')
  );
}

function providerTextOf(failure: MutationFailure): string | null {
  return failure.details.find((d) => d.provider_text !== undefined)?.provider_text ?? null;
}

interface Props {
  account: WhatsAppAccountView;
  number: WhatsAppNumberView;
  onClose: () => void;
  /** Relecture de la page après un changement du nom (colonne « Nom affiché », alerte de la carte). */
  onChanged: () => void;
}

/**
 * Fenêtre « Profil WhatsApp » d'un numéro d'un compte Meta (spec R2a §5.2 et §5.3, maquette 04) : encart du nom affiché
 * en tête, profil lu chez Meta (squelette pendant la lecture, raison et « Réessayer » en échec), aperçu de ce que voit
 * le contact. « Enregistrer » n'envoie que les champs modifiés, un champ vidé compris, puis affiche la version relue.
 * Le profil n'est gardé nulle part en dehors de cette fenêtre.
 */
export function ProfileDialog({ account, number, onClose, onChanged }: Props) {
  const t = useTranslations('connections.profile');
  const tv = useTranslations('connections.profile.verticals');
  const tRoot = useTranslations();
  const mediumDate = useMediumDate();
  const describe = useDescribeFailure();
  const baseId = useId();
  const profilePath = `${accountPath(account.id)}/numbers/${number.id}/profile`;

  const [current, setCurrent] = useState(number);
  useEffect(() => setCurrent(number), [number]);
  const [reading, setReading] = useState<Reading>({ phase: 'loading' });
  const [ready, setReady] = useState<Ready | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [nameBusy, setNameBusy] = useState(false);
  const busyRef = useRef(false);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<ProfileFieldPath, string>>>({});
  const [topError, setTopError] = useState<ShownFailure | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [photoError, setPhotoError] = useState<ShownFailure | null>(null);
  // `warning` : écriture confirmée, relecture en échec (Ruling R-28 : ni réussite ni erreur).
  const [photoNotice, setPhotoNotice] = useState<{ text: string; tone: 'success' | 'warning' } | null>(null);
  const fieldRefs = useRef<Partial<Record<ProfileFieldPath, HTMLElement | null>>>({});
  const sequence = useRef(0);

  // La lecture ne dépend que du chemin du profil et de son texte contextuel : `describe` change à chaque rendu.
  const describeRef = useRef(describe);
  describeRef.current = describe;
  const loadFailed = t('loadFailed');
  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setReading({ phase: 'loading' });
    const result = await sendMutation(profilePath, 'GET', undefined, loadFailed, 'Connections');
    if (mine !== sequence.current) return;
    if ('res' in result) {
      const body = await readJsonBody<unknown>(result.res);
      if (mine !== sequence.current) return;
      if (isProfile(body)) {
        const draft = draftOf(body);
        setReady({ baseline: draft, draft, photoUrl: body.photo_url, readAt: body.read_at });
        setReading({ phase: 'ready' });
        return;
      }
      console.error('[Connections] profil WhatsApp illisible');
      setReading({ phase: 'failed', failure: { described: { kind: 'server', message: loadFailed, fieldErrors: {}, reference: null }, providerText: null } });
      return;
    }
    if (result.orgChanged) return;
    setReading({ phase: 'failed', failure: { described: describeRef.current(result, loadFailed), providerText: providerTextOf(result) } });
  }, [profilePath, loadFailed]);

  useEffect(() => {
    void load();
    return () => {
      sequence.current += 1;
    };
  }, [load]);

  const busy = saving || uploading || nameBusy;
  const localErrors = ready ? draftErrors(ready.draft) : {};

  /** Erreur montrée sous un champ : refus du moteur, sinon refus local (l'e-mail seulement après un essai d'envoi). */
  function shownError(path: ProfileFieldPath): string | null {
    const server = serverErrors[path];
    if (server !== undefined) return server;
    const local: DraftError | undefined = localErrors[path];
    if (local === undefined || (local.key === 'emailInvalid' && !attempted)) return null;
    return local.key === 'tooLong' ? t('errors.tooLong', { max: local.max }) : t(`errors.${local.key}`);
  }

  function edit(path: ProfileFieldPath, change: (draft: ProfileDraft) => ProfileDraft) {
    setReady((previous) => (previous ? { ...previous, draft: change(previous.draft) } : previous));
    // Le refus du moteur d'un champ s'efface quand ce champ change (pour les sites : tous les refus des sites).
    setServerErrors((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([k]) => (path.startsWith('websites') ? !k.startsWith('websites') : k !== path))),
    );
    setNotice(null);
  }

  function focusFirst(paths: Iterable<string>) {
    const set = new Set(paths);
    const first = PROFILE_FIELD_PATHS.find((p) => set.has(p));
    if (first !== undefined) (fieldRefs.current[first] ?? fieldRefs.current[first === 'websites' ? 'websites.0' : first])?.focus();
  }

  async function save() {
    if (!ready || busyRef.current) return;
    setAttempted(true);
    setTopError(null);
    setNotice(null);
    // Revue finale M-e : seuls les champs envoyés bloquent ; un champ non touché tel que Meta le rend n'est pas envoyé.
    const blocking = blockingErrors(ready.baseline, ready.draft);
    if (blocking.length > 0) {
      focusFirst(blocking);
      return;
    }
    const patch = changedFields(ready.baseline, ready.draft);
    if (Object.keys(patch).length === 0) {
      setNotice({ kind: 'noChange' });
      return;
    }
    busyRef.current = true;
    setSaving(true);
    setServerErrors({});
    const result = await sendMutation(profilePath, 'PUT', patch, t('saveFailed'), 'Connections');
    busyRef.current = false;
    setSaving(false);
    if ('res' in result) {
      const body = await readJsonBody<unknown>(result.res);
      if (isProfile(body)) {
        const draft = draftOf(body);
        setReady({ baseline: draft, draft, photoUrl: body.photo_url, readAt: body.read_at });
      }
      setNotice({ kind: 'saved' });
      return;
    }
    if (result.orgChanged) return;
    const described = describe(result, t('saveFailed'), PROFILE_FIELD_PATHS);
    if (result.reason === SAVED_UNREAD) {
      // Ruling R-17 : Meta a confirmé l'écriture, seule la relecture a échoué. La saisie envoyée devient la version de
      // référence (rien n'est renvoyé deux fois) ; l'avis n'est pas une erreur.
      setReady((previous) => (previous ? { ...previous, baseline: previous.draft } : previous));
      setNotice({ kind: 'text', text: described.message });
      return;
    }
    const fieldErrors = described.fieldErrors as Partial<Record<ProfileFieldPath, string>>;
    if (Object.keys(fieldErrors).length > 0) {
      setServerErrors(fieldErrors);
      focusFirst(Object.keys(fieldErrors));
      return;
    }
    setTopError({ described, providerText: providerTextOf(result) });
  }

  async function uploadPhoto(file: File) {
    if (busyRef.current) return;
    setPhotoError(null);
    setPhotoNotice(null);
    const accepted = PROFILE_PHOTO_TYPES.some((type) => type === file.type) && file.size > 0 && file.size <= PROFILE_PHOTO_MAX_BYTES;
    if (!accepted) {
      setPhotoError({
        described: { kind: 'field', message: tRoot('errors.reasons.whatsapp_account.photo_invalid'), fieldErrors: {}, reference: null },
        providerText: null,
      });
      return;
    }
    busyRef.current = true;
    setUploading(true);
    const result = await sendFile(`${profilePath}/photo`, file, t('photoFailed'), 'Connections');
    busyRef.current = false;
    setUploading(false);
    if ('res' in result) {
      const body = await readJsonBody<unknown>(result.res);
      if (isProfile(body)) {
        // Photo relue chez Meta ; la saisie en cours des autres champs est gardée, comparée à la version relue.
        setReady((previous) => (previous ? { ...previous, baseline: draftOf(body), photoUrl: body.photo_url, readAt: body.read_at } : previous));
      }
      setPhotoNotice({ text: t('photoDone'), tone: 'success' });
      return;
    }
    if (result.orgChanged) return;
    const described = describe(result, t('photoFailed'), ['photo']);
    if (result.reason === SAVED_UNREAD) {
      setPhotoNotice({ text: described.message, tone: 'warning' });
      return;
    }
    setPhotoError({ described: { ...described, message: described.fieldErrors['photo'] ?? described.message }, providerText: providerTextOf(result) });
  }

  const id = (name: string) => `${baseId}-${name}`;
  const readAt = ready ? parseEngineDate(ready.readAt) : null;

  function counter(value: string, max: number, counterId: string) {
    const count = codePoints(value);
    return (
      <span id={counterId} className={`text-[11.5px] font-normal ${count > max ? 'text-danger' : 'text-muted'}`}>
        {t('counter', { count, max })}
      </span>
    );
  }

  function describedBy(...ids: (string | null)[]): string | undefined {
    const list = ids.filter((v): v is string => v !== null);
    return list.length > 0 ? list.join(' ') : undefined;
  }

  function textField(field: ProfileTextField, label: string, multiline = false) {
    if (!ready) return null;
    const value = ready.draft[field];
    const error = shownError(field);
    const inputId = id(field);
    const props = {
      id: inputId,
      value,
      disabled: saving,
      'aria-invalid': error !== null || undefined,
      'aria-describedby': describedBy(error !== null ? id(`${field}-error`) : null, id(`${field}-counter`)),
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const next = e.target.value;
        edit(field, (d) => ({ ...d, [field]: next }));
      },
      className: multiline ? `${INPUT} min-h-[64px] resize-y` : INPUT,
    };
    return (
      <div data-profile-field={field} className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={inputId} className={LABEL}>{label}</label>
          {counter(value, BUSINESS_PROFILE_LIMITS[field], id(`${field}-counter`))}
        </div>
        {multiline ? (
          <textarea ref={(el) => { fieldRefs.current[field] = el; }} {...props} />
        ) : (
          <input ref={(el) => { fieldRefs.current[field] = el; }} type={field === 'email' ? 'email' : 'text'} {...props} />
        )}
        {error !== null && <p id={id(`${field}-error`)} className="mt-1 text-[12.5px] text-danger">{error}</p>}
      </div>
    );
  }

  function websiteField(index: 0 | 1) {
    if (!ready) return null;
    const path: ProfileFieldPath = index === 0 ? 'websites.0' : 'websites.1';
    const value = ready.draft.websites[index] ?? '';
    const error = shownError(path);
    const inputId = id(`website-${index}`);
    const counterId = id(`website-${index}-counter`);
    const errorId = id(`website-${index}-error`);
    return (
      <div className={index === 1 ? 'mt-2' : ''}>
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={inputId} className="mb-1 block text-[12.5px] text-muted">{index === 0 ? t('website1') : t('website2')}</label>
          {counter(value, BUSINESS_PROFILE_LIMITS.website, counterId)}
        </div>
        <input
          ref={(el) => { fieldRefs.current[path] = el; }}
          id={inputId}
          type="text"
          inputMode="url"
          value={value}
          disabled={saving}
          aria-invalid={error !== null || undefined}
          aria-describedby={describedBy(error !== null ? errorId : null, counterId)}
          onChange={(e) => {
            const next = e.target.value;
            edit(path, (d) => {
              const websites = [...d.websites];
              websites[index] = next;
              return { ...d, websites };
            });
          }}
          className={INPUT}
        />
        {error !== null && <p id={errorId} className="mt-1 text-[12.5px] text-danger">{error}</p>}
      </div>
    );
  }

  const verticalError = shownError('vertical');
  const websitesError = shownError('websites');

  return (
    <DialogFrame wide title={t('title', { number: formatPhone(number.phone_e164) })} onClose={onClose} busy={busy}>
      <p className="text-[13px] text-muted">{t('intro')}</p>
      {readAt !== null && reading.phase === 'ready' && (
        <p className="mt-0.5 text-[12px] text-muted">{t('readAt', { date: mediumDate(readAt, { time: true }) })}</p>
      )}
      {topError !== null && (
        <div className="mt-3">
          <InlineError message={topError.described.message} reference={topError.described.reference} />
          {topError.providerText !== null && <ProviderTextDetail text={topError.providerText} />}
        </div>
      )}

      <div className="mt-3.5 grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <DisplayNamePanel
            account={account}
            number={current}
            onBusyChange={setNameBusy}
            onNumberChanged={(view) => {
              setCurrent(view);
              onChanged();
            }}
          />

          {reading.phase === 'loading' && (
            <div aria-busy="true" className="mt-3 rounded-xl border border-border px-3.5 py-3">
              <span className="sr-only">{t('loading')}</span>
              <div className="flex items-center gap-3">
                <Skeleton className="h-[54px] w-[54px] shrink-0 rounded-full" />
                <Skeleton className="h-8 w-36 rounded-full" />
              </div>
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className="mt-3.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-1.5 h-9 w-full" />
                </div>
              ))}
            </div>
          )}

          {reading.phase === 'failed' && (
            <div className="mt-3">
              <InlineError
                message={reading.failure.described.message}
                reference={reading.failure.described.reference}
                action={<CancelButton onClick={() => void load()}>{t('retry')}</CancelButton>}
              />
              {reading.failure.providerText !== null && <ProviderTextDetail text={reading.failure.providerText} />}
            </div>
          )}

          {reading.phase === 'ready' && ready !== null && (
            <div className="mt-3 rounded-xl border border-border bg-surface px-3.5 py-3">
              <div data-profile-field="photo" className="flex flex-wrap items-center gap-3">
                <ProfileAvatar name={current.display_name} photoUrl={ready.photoUrl} size="md" />
                <div className="min-w-0">
                  <input
                    id={id('photo')}
                    type="file"
                    accept={PROFILE_PHOTO_TYPES.join(',')}
                    disabled={busy}
                    aria-describedby={id('photo-hint')}
                    className="peer sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file !== undefined) void uploadPhoto(file);
                    }}
                  />
                  {/* Le champ fichier est masqué, son libellé tient lieu de bouton : le focus clavier reste sur le champ. */}
                  <label
                    htmlFor={id('photo')}
                    className={`inline-block cursor-pointer rounded-pill border border-border-strong bg-surface px-3.5 py-1.5 text-[12.5px] font-semibold peer-disabled:cursor-not-allowed peer-disabled:text-muted-2 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-ink`}
                  >
                    {t('photoChange')}
                  </label>
                  <p id={id('photo-hint')} className="mt-1 text-[12px] text-muted">{t('photoHint')}</p>
                  {uploading && <p aria-busy="true" className="mt-1 text-[12px] text-muted">{t('photoSending')}</p>}
                </div>
              </div>
              {photoError !== null && (
                <div className="mt-2">
                  <InlineError message={photoError.described.message} reference={photoError.described.reference} />
                  {photoError.providerText !== null && <ProviderTextDetail text={photoError.providerText} />}
                </div>
              )}
              {photoNotice !== null && (
                <p role="status" className={`mt-2 text-[12.5px] font-semibold ${NOTICE_TONE[photoNotice.tone]}`}>{photoNotice.text}</p>
              )}

              {textField('about', t('about'))}
              {textField('description', t('description'), true)}

              <div data-profile-field="vertical" className="mt-3">
                <label htmlFor={id('vertical')} className={LABEL}>{t('vertical')}</label>
                <select
                  ref={(el) => { fieldRefs.current.vertical = el; }}
                  id={id('vertical')}
                  value={ready.draft.vertical}
                  disabled={saving}
                  aria-invalid={verticalError !== null || undefined}
                  aria-describedby={verticalError !== null ? id('vertical-error') : undefined}
                  onChange={(e) => {
                    const next = e.target.value;
                    edit('vertical', (d) => ({ ...d, vertical: next }));
                  }}
                  className={INPUT}
                >
                  {ready.baseline.vertical === '' && <option value="" disabled>{t('verticalNone')}</option>}
                  {WHATSAPP_VERTICALS.map((v) => (
                    <option key={v} value={v}>{tv(v)}</option>
                  ))}
                </select>
                {verticalError !== null && <p id={id('vertical-error')} className="mt-1 text-[12.5px] text-danger">{verticalError}</p>}
              </div>

              {textField('address', t('address'))}
              {textField('email', t('email'))}

              <fieldset data-profile-field="websites" className="mt-3" aria-describedby={websitesError !== null ? id('websites-error') : undefined}>
                <legend className="mb-1.5 flex w-full items-baseline justify-between gap-2 text-[13px] font-semibold">
                  {t('websites')} <span className="text-[11.5px] font-normal text-muted">{t('websitesMax')}</span>
                </legend>
                {websiteField(0)}
                {ready.draft.websites.length > 1 && websiteField(1)}
                {ready.draft.websites.length === 1 && (ready.draft.websites[0] ?? '').trim() !== '' && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => edit('websites', (d) => ({ ...d, websites: [...d.websites, ''] }))}
                    className={`mt-2 text-[12.5px] font-semibold text-accent-ink underline disabled:text-muted-2 ${FOCUS_RING}`}
                  >
                    {t('addWebsite')}
                  </button>
                )}
                {websitesError !== null && <p id={id('websites-error')} className="mt-1 text-[12.5px] text-danger">{websitesError}</p>}
              </fieldset>
            </div>
          )}
        </div>

        <div className="min-w-0">
          {reading.phase === 'ready' && ready !== null ? (
            <ProfilePreview displayName={current.display_name} draft={ready.draft} photoUrl={ready.photoUrl} />
          ) : (
            <div aria-hidden="true">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="mt-2 h-[260px] w-full rounded-2xl" />
            </div>
          )}
        </div>
      </div>

      {notice !== null && (
        <p role="status" className={`mt-3 text-[12.5px] font-semibold ${notice.kind === 'saved' ? `text-right ${NOTICE_TONE.success}` : notice.kind === 'noChange' ? `text-right ${NOTICE_TONE.neutral}` : NOTICE_TONE.warning}`}>
          {notice.kind === 'saved' ? t('saved') : notice.kind === 'noChange' ? t('noChange') : notice.text}
        </p>
      )}
      <DialogActions>
        <CancelButton busy={busy} onClick={onClose}>{t('close')}</CancelButton>
        {reading.phase === 'ready' && (
          <PrimaryButton type="button" disabled={busy} onClick={() => void save()}>{t('save')}</PrimaryButton>
        )}
      </DialogActions>
    </DialogFrame>
  );
}
