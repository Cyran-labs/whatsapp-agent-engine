'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { isServingStatus, type WhatsAppAccountView, type WhatsAppNumberView } from '@wabagent/contracts';
import { Link } from '@/i18n/routing';
import { AllowlistEditor } from '@/components/numbers/allowlist-editor';
import { StatusPill } from '@/components/agents/status-pill';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, isOrgChanged, readJsonBody, sendMutation, type MutationFailure } from '@/lib/api-fetch';
import { useRefreshOnVisible } from '@/lib/use-refresh-on-visible';
import type { EntitySummary } from '@/lib/entities';
import { LANGUAGE_LABELS, type WizardState } from '@/lib/bot-draft';
import { formatPhone } from '@/lib/whatsapp-display';
import { StepCounter, WIZARD_PANE } from './stepper';

const BILLING_URL = 'https://business.facebook.com/billing_hub/';
const CONNECTIONS_HREF = '/organisation/connexions';
const GO = 'whitespace-nowrap rounded-xl bg-success px-4 py-[11px] text-[13.5px] font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const GHOST = 'whitespace-nowrap rounded-xl border border-border-strong bg-surface px-4 py-[11px] text-[13.5px] font-semibold text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50';
const LINK = 'font-semibold text-accent-ink underline-offset-2 hover:underline';
/** Refus qui pointent vers Connexions : numéro ou compte introuvable (404), compte non connecté ou numéro refusé (409). */
const CONNECTIONS_STATUSES: ReadonlySet<number> = new Set([404, 409]);
/** Le moteur désigne une entrée refusée de la liste par `allowlist.<i>` (route d'activation). */
const ROW_ERROR_PATH = /^allowlist\.(\d+)$/;

export interface Activated {
  status: 'limited' | 'active';
  /** Numéro branché au format E.164, tel que le moteur l'a répondu ; `null` : réponse illisible, rien à afficher. */
  phone: string | null;
}

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Statut et numéro de la réponse de `POST /activate` (`BotDetail`) : ce que le moteur vient d'écrire, jamais la dernière
 * lecture de la liste, qui a pu changer entre-temps (revue 2b-3 M-3). Un numéro illisible donne `null` : la confirmation
 * s'affiche alors sans QR code ni lien `wa.me`. Le statut illisible retombe sur celui demandé, que le moteur a accepté.
 */
function activatedFrom(body: unknown, requested: 'limited' | 'active'): Activated {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const status = record.status === 'limited' || record.status === 'active' ? record.status : requested;
  const number = record.whatsapp_number;
  const phone = typeof number === 'object' && number !== null ? (number as Record<string, unknown>).phone_e164 : null;
  return { status, phone: typeof phone === 'string' && E164.test(phone) ? phone : null };
}

interface Props {
  botId: string;
  numberId: number;
  state: WizardState;
  /** Liste d'accès limité en cours de saisie : tenue par l'assistant pour survivre à « Changer de numéro ». */
  entries: string[];
  onEntriesChange: (entries: string[]) => void;
  /** Entité de l'agent IA telle que le moteur l'a enregistrée (réponse de la création), `null` : aucune. */
  entityId: number | null;
  /** Entités actives de l'organisation, pour nommer `entityId`. */
  entities: EntitySummary[];
  /** Retour à l'étape Numéro. */
  onBack: () => void;
  /** Termine l'assistant, l'agent IA reste en brouillon. */
  onLater: () => void;
  onActivated: (result: Activated) => void;
}

type Listing = { phase: 'loading' } | { phase: 'failed' } | { phase: 'ready'; accounts: WhatsAppAccountView[] };
type Found = { account: WhatsAppAccountView; number: WhatsAppNumberView };

function findNumber(accounts: WhatsAppAccountView[], numberId: number): Found | null {
  for (const account of accounts) {
    const number = account.numbers.find((n) => n.id === numberId);
    if (number) return { account, number };
  }
  return null;
}

type Tone = 'ok' | 'warn' | 'bad';
const MARK: Record<Tone, string> = { ok: '✓', warn: '!', bad: '✕' };
const MARK_CLASS: Record<Tone, string> = { ok: 'text-success-ink', warn: 'text-warning-ink', bad: 'text-danger' };

function Check({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <li className={tone === 'bad' ? 'text-danger' : undefined}>
      <span aria-hidden="true" className={`mr-[7px] font-bold ${MARK_CLASS[tone]}`}>{MARK[tone]}</span>
      {children}
    </li>
  );
}

function ConnectionsLink({ label }: { label: string }) {
  return (
    <>
      {' '}
      <Link href={CONNECTIONS_HREF} target="_blank" rel="noopener noreferrer" className={LINK}>{label}</Link>
    </>
  );
}

/**
 * Étape 5 : récapitulatif, contrôles relus, liste d'accès limité, puis activation en une seule opération du moteur
 * (brancher le numéro, enregistrer la liste, changer le statut). Un refus n'écrit rien : l'agent IA reste en brouillon.
 */
export function StepActivate({ botId, numberId, state, entries, onEntriesChange, entityId, entities, onBack, onLater, onActivated }: Props) {
  const t = useTranslations('wizard.activate');
  const format = useFormatter();
  const reasonId = useId();
  const headingId = useId();
  const [listing, setListing] = useState<Listing>({ phase: 'loading' });
  const [draft, setDraft] = useState('');
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [refusal, setRefusal] = useState<{ message: string; connections: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Garde de double envoi : l'état `busy` n'est rendu qu'après le clic, la référence l'est tout de suite (revue finale 2b-3 m-10).
  const busyRef = useRef(false);
  // Seule la dernière lecture compte ; une réponse arrivée après le démontage est ignorée.
  const sequence = useRef(0);
  const mounted = useRef(true);

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
      console.error('[Wizard] relecture du numéro WhatsApp impossible', err);
      // Une relecture en échec garde la lecture déjà affichée.
      if (mine === sequence.current) setListing((previous) => (previous.phase === 'ready' ? previous : { phase: 'failed' }));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, [load]);
  // Numéro retiré, compte reconnecté ou numéro pris dans un autre onglet : la lecture se refait au retour.
  useRefreshOnVisible(() => void load());

  // Une entité absente de la liste (liste illisible, entité archivée depuis) est dite inconnue, jamais omise.
  const entityLabel = entityId === null ? t('recap.noEntity') : (entities.find((e) => e.id === entityId)?.name ?? t('recap.entityUnknown'));

  const found = listing.phase === 'ready' ? findNumber(listing.accounts, numberId) : null;
  const isTest = found?.number.is_test ?? false;
  const status = isTest ? 'active' : 'limited';
  const numberGone = listing.phase === 'ready' && (found === null || found.number.provider_state === 'removed');
  // Seul un compte connecté peut activer (spec 2b §8.1) : en erreur ou déconnecté, le moteur refuserait.
  const accountGone = found !== null && found.account.state !== 'connected';
  const healthy = found !== null && !numberGone && !accountGone;

  // Un refus affiché n'a plus lieu d'être quand une relecture remet les contrôles au vert (compte reconnecté,
  // numéro de nouveau disponible) : il resterait sinon à côté d'un bouton qui dit le contraire.
  const wasHealthy = useRef(true);
  useEffect(() => {
    if (listing.phase !== 'ready') return;
    if (healthy && !wasHealthy.current) setRefusal(null);
    wasHealthy.current = healthy;
  }, [listing.phase, healthy]);

  let reason: string | null = null;
  if (listing.phase === 'loading') reason = t('loadingReason');
  else if (listing.phase === 'failed') reason = t('failedReason');
  else if (numberGone) reason = t('blockedNumber');
  else if (accountGone) reason = t('blockedAccount');
  else if (draft.trim() !== '') reason = t('draftReason');
  else if (!isTest && entries.length === 0) reason = t('emptyReason');

  const showRefusal = (failure: MutationFailure) => {
    const perRow: Record<number, string> = {};
    for (const detail of failure.details) {
      const match = ROW_ERROR_PATH.exec(detail.path);
      if (match) perRow[Number(match[1])] = detail.message ?? failure.error;
    }
    if (Object.keys(perRow).length > 0) {
      setRowErrors(perRow);
      return;
    }
    setRefusal({ message: failure.error, connections: CONNECTIONS_STATUSES.has(failure.status) });
  };

  const activate = async () => {
    if (busyRef.current || busy || reason !== null || found === null) return;
    busyRef.current = true;
    setBusy(true);
    setRefusal(null);
    setRowErrors({});
    const result = await sendMutation(
      `/api/bots/${encodeURIComponent(botId)}/activate`,
      'POST',
      // Détenteur vu par l'écran : refus 409 du moteur si le numéro a changé de main entre-temps (revue 2b-3 M-1).
      { number_id: numberId, expected_bot_id: found.number.bot?.bot_id ?? null, status, allowlist: entries },
      t('activateFailed'),
      'Wizard',
    );
    if (!mounted.current) return;
    if ('res' in result) {
      // Le bouton reste occupé : l'assistant passe à la confirmation, pas de seconde activation possible.
      onActivated(activatedFrom(await readJsonBody<unknown>(result.res), status));
      return;
    }
    busyRef.current = false;
    setBusy(false);
    // Organisation changée dans un autre onglet : la page se recharge, rien à afficher ni à renvoyer.
    if (result.orgChanged) return;
    showRefusal(result);
    // Le refus vient souvent d'un état qui a bougé (compte, numéro) : les contrôles se relisent.
    void load();
  };

  const checks = (() => {
    if (listing.phase === 'loading') {
      return (
        <div aria-busy="true" className="mt-3">
          <p role="status" className="sr-only">{t('loading')}</p>
          <Skeleton className="h-[72px] w-full rounded-xl" />
        </div>
      );
    }
    if (listing.phase === 'failed') {
      return (
        <div className="mt-3 rounded-xl border border-border bg-surface px-4 py-4 text-center">
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
      );
    }
    const now = new Date();
    const taken = found?.number.bot ?? null;
    return (
      <ul aria-label={t('checks.label')} className="mt-3 space-y-0.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-[13px] leading-[1.9]">
        {found === null && <Check tone="bad">{t('checks.numberMissing')}<ConnectionsLink label={t('checks.openConnections')} /></Check>}
        {found !== null && found.number.provider_state === 'removed' && (
          <Check tone="bad">{t('checks.numberRemoved')}<ConnectionsLink label={t('checks.openConnections')} /></Check>
        )}
        {found !== null && found.number.provider_state === 'present' && taken === null && <Check tone="ok">{t('checks.numberFree')}</Check>}
        {found !== null && found.number.provider_state === 'present' && taken !== null && taken.bot_id === botId && (
          <Check tone="ok">{t('checks.numberMine')}</Check>
        )}
        {found !== null && found.number.provider_state === 'present' && taken !== null && taken.bot_id !== botId && (
          <Check tone="warn">
            {t.rich('checks.numberTaken', {
              bot: taken.name,
              serving: isServingStatus(taken.status) ? 'yes' : 'other',
              b: (chunks) => <b>{chunks}</b>,
            })}
          </Check>
        )}
        {found !== null && found.account.state === 'connected' && (
          <Check tone="ok">
            {found.account.last_verified_at
              ? t('checks.accountOk', { when: format.relativeTime(new Date(found.account.last_verified_at), now) })
              : t('checks.accountNeverVerified')}
          </Check>
        )}
        {found !== null && found.account.state === 'error' && (
          <Check tone="bad">{t('checks.accountError')}<ConnectionsLink label={t('checks.openConnections')} /></Check>
        )}
        {found !== null && found.account.state === 'disconnected' && (
          <Check tone="bad">{t('checks.accountDisconnected')}<ConnectionsLink label={t('checks.openConnections')} /></Check>
        )}
        <Check tone="warn">
          {t('checks.billing')}{' '}
          <a href={BILLING_URL} target="_blank" rel="noopener noreferrer" className={LINK}>{t('checks.billingLink')}</a>
        </Check>
      </ul>
    );
  })();

  return (
    <div className={`${WIZARD_PANE} pb-12`}>
      <StepCounter step={5} centered />
      <h1 className="mt-1.5 text-center font-serif text-2xl text-fg">{t('title')}</h1>
      <p className="mb-[18px] mt-1.5 text-center text-muted">{isTest ? t('leadTest') : t('leadLimited')}</p>

      <ul aria-label={t('recap.label')} className="rounded-xl border border-border bg-surface px-4 py-1">
        <RecapRow label={t('recap.agent')}><span className="font-semibold">{state.name}</span></RecapRow>
        <RecapRow label={t('recap.entity')}>
          <span className="font-semibold">{entityLabel}</span>
        </RecapRow>
        <RecapRow label={t('recap.languages')}>
          <span className="font-semibold">{state.languages.map((l) => LANGUAGE_LABELS[l] ?? l).join(' · ')}</span>
        </RecapRow>
        {found !== null && (
          <RecapRow label={t('recap.number')}><span className="font-mono text-[13px]">{formatPhone(found.number.phone_e164)}</span></RecapRow>
        )}
        <RecapRow label={t('recap.status')}><StatusPill status="draft" /></RecapRow>
      </ul>

      {checks}

      <section aria-labelledby={headingId} className="mt-5">
        <h2 id={headingId} className="font-serif text-lg text-fg">{t('allowlistTitle')}</h2>
        <p className="mb-3 mt-0.5 text-[12.5px] text-muted-2">{isTest ? t('allowlistLeadTest') : t('allowlistLead')}</p>
        <AllowlistEditor
          entries={entries}
          errors={rowErrors}
          disabled={busy}
          onDraftChange={setDraft}
          onChange={(next) => {
            onEntriesChange(next);
            // Les indices des erreurs affichées ne valent que pour la liste envoyée.
            setRowErrors({});
          }}
        />
      </section>

      {refusal && (
        <div className="mt-4">
          <p role="alert" className="text-danger">{refusal.message}</p>
          {refusal.connections && (
            <p className="mt-1">
              <Link href={CONNECTIONS_HREF} target="_blank" rel="noopener noreferrer" className={LINK}>{t('checks.openConnections')}</Link>
            </p>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} disabled={busy} className="whitespace-nowrap text-[13.5px] font-semibold text-muted hover:text-fg disabled:opacity-50">← {t('back')}</button>
        <span className="ml-auto flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onLater} disabled={busy} className={GHOST}>{t('later')}</button>
          <button
            type="button"
            onClick={() => void activate()}
            disabled={busy || reason !== null}
            aria-describedby={!busy && reason !== null ? reasonId : undefined}
            className={GO}
          >
            {busy ? t('activating') : isTest ? t('activateTest') : t('activateLimited')}
          </button>
        </span>
      </div>
      {!busy && reason !== null && <p id={reasonId} className="mt-2 text-right text-[12.5px] text-muted">{reason}</p>}
    </div>
  );
}

function RecapRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between border-t border-border py-[9px] text-[13.5px] first:border-t-0">
      <span className="text-muted-2">{label}</span>
      {children}
    </li>
  );
}
