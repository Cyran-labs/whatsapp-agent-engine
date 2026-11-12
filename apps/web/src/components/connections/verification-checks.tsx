import { useLocale, useTranslations } from 'next-intl';
import { NON_CHECK_DETAIL_PATHS, VERIFICATION_CHECK_KEYS, WEBHOOK_CLEANUP_DETAIL, type WhatsAppVerificationCheck } from '@wabagent/contracts';
import type { MutationDetail } from '@/lib/api-fetch';
import { ProviderTextDetail, TextDetail } from './provider-text';

/**
 * Contrôle tel que le web le reçoit : sa clé peut être inconnue de cette version du web (nouveau contrôle du moteur).
 * Un contrôle connu a son libellé traduit ; un contrôle inconnu s'affiche avec sa clé brute, jamais ignoré.
 */
export type ShownCheck = Omit<WhatsAppVerificationCheck, 'key'> & { key: string };

function isCheckKey(key: string): key is WhatsAppVerificationCheck['key'] {
  return (VERIFICATION_CHECK_KEYS as readonly string[]).includes(key);
}

/**
 * Contrôle de vérification qui désigne un champ que l'admin a saisi (audit des décisions A19) : le secret de l'app
 * (`app_secret`, contrôle et champ de même nom) et le jeton d'accès (contrôle `token`, champ `access_token`). Les clés
 * sont des `VerificationCheckKey` des contrats : une clé qui n'est pas un contrôle ne compile pas.
 */
const CHECK_FIELD: Readonly<Partial<Record<WhatsAppVerificationCheck['key'], 'app_secret' | 'access_token'>>> = {
  app_secret: 'app_secret',
  token: 'access_token',
};

/**
 * Champs affichés désignés par les contrôles en échec d'un 422, dans l'ordre de l'écran (`shown`). La liste des
 * contrôles reste affichée : ces champs sont en plus marqués (`aria-invalid`, focus sur le premier).
 */
export function refusedFieldsFromChecks<F extends string>(details: readonly MutationDetail[], shown: readonly F[]): F[] {
  const refused = new Set<string>(
    details.map((d) => (isCheckKey(d.path) ? CHECK_FIELD[d.path] : undefined)).filter((f): f is 'app_secret' | 'access_token' => f !== undefined),
  );
  return shown.filter((f) => refused.has(f));
}

/**
 * Le 422 WA_VALIDATION_FAILED du moteur porte les contrôles en échec dans `error.details` (clé du contrôle en
 * `path`) : chacun redevient un contrôle en échec, y compris un contrôle que ce web ne connaît pas encore.
 */
export function checksFromDetails(details: readonly MutationDetail[]): ShownCheck[] {
  // Relecture finale R1 FR-I1 : le bilan du retrait et la mention de panne passagère ne sont pas des contrôles.
  return details.filter((d) => !NON_CHECK_DETAIL_PATHS.includes(d.path)).map((d): ShownCheck => ({
    key: d.path,
    status: 'failed',
    ...(d.message === undefined ? {} : { detail: d.message }),
    ...(d.provider_text === undefined ? {} : { provider_text: d.provider_text }),
  }));
}

/**
 * Relecture finale R1 FR-I1 (spec R1 §5.2) : bilan du retrait de l'adresse inscrite chez Meta après un raccordement
 * refusé, lu par sa clé (jamais par le texte du moteur) ; null si le refus n'en porte pas.
 */
export function cleanupFromDetails(details: readonly MutationDetail[]): 'done' | 'failed' | null {
  if (details.some((d) => d.path === WEBHOOK_CLEANUP_DETAIL.failed)) return 'failed';
  if (details.some((d) => d.path === WEBHOOK_CLEANUP_DETAIL.done)) return 'done';
  return null;
}

/** Phrase du bilan du retrait : neutre s'il a réussi, en alerte s'il a échoué. */
export function WebhookCleanupNotice({ cleanup }: { cleanup: 'done' | 'failed' }) {
  const t = useTranslations('connections.checks');
  return (
    <p data-cleanup={cleanup} className={`mt-2 text-[13px] ${cleanup === 'failed' ? 'text-warning-ink' : 'text-muted'}`}>
      {cleanup === 'failed' ? t('cleanupFailed') : t('cleanupDone')}
    </p>
  );
}

const ICON: Record<WhatsAppVerificationCheck['status'], string> = { ok: '✓', created: '✓', pending: '…', failed: '✗' };

/** Contrôles des webhooks inscrits par le moteur (audit des décisions R1 N-9) : « inscrit chez Meta », pas « abonnement créé ». */
const WEBHOOK_CHECKS: readonly string[] = ['webhook_waba', 'webhook_app'];

/**
 * Une ligne par contrôle de vérification : libellé, état, détail du moteur s'il y en a un. Le détail du moteur est en
 * français : en clair en français, replié en anglais sous le statut traduit, comme `AccountErrorSentence` (revue finale M-4).
 */
export function VerificationChecks({ checks }: { checks: readonly ShownCheck[] }) {
  const t = useTranslations('connections.checks');
  const tAlerts = useTranslations('connections.alerts');
  const french = useLocale() === 'fr';
  const createdText = (key: string): string => (WEBHOOK_CHECKS.includes(key) ? t('createdWebhook') : t('created'));
  return (
    <ul aria-label={t('listLabel')} className="mt-3 rounded-lg border border-border bg-surface-subtle px-3 py-1">
      {checks.map((check, index) => {
        // Message du fournisseur (`provider_text`, de l'anglais pour Meta) : une phrase traduite dans la ligne, le texte
        // dans un détail repliable ; sans `provider_text`, le texte du moteur s'affiche tel quel en français (audit R-21).
        const raw = check.provider_text ?? null;
        const engineDetail = raw === null ? (check.detail ?? null) : null;
        // En anglais, le texte du moteur n'est jamais en clair : le statut traduit tient sa place, le texte est replié.
        const folded = !french && engineDetail !== null ? engineDetail : null;
        // recette 10 nov. 2026 : le libellé nomme ce qui est vérifié, le résultat est toujours écrit à côté (jamais
        // seulement l'icône ni un texte pour lecteur d'écran) : sans autre phrase, l'état lui-même.
        const statusText = t(`status.${check.status}`);
        const explained = raw !== null
          ? t('providerRefused')
          : folded !== null
            ? statusText
            : (engineDetail ?? (check.status === 'pending' ? t('pending') : check.status === 'created' ? createdText(check.key) : null));
        const note = explained ?? statusText;
        const noteIsStatus = note === statusText;
        return (
          <li
            key={`${check.key}-${index}`}
            className={`flex items-start gap-2 border-t border-border py-1.5 text-[13px] first:border-t-0 ${check.status === 'failed' ? 'text-danger' : 'text-fg'}`}
          >
            <span aria-hidden="true" className="w-3.5 shrink-0 text-center font-bold">{ICON[check.status]}</span>
            <span>
              <span className="font-semibold">{isCheckKey(check.key) ? t(`keys.${check.key}`) : check.key}</span>
              {folded === null && !noteIsStatus && <span className="sr-only"> : {statusText}</span>}
              {note && (
                <>
                  {' '}
                  <span className={check.status === 'failed' ? '' : 'text-muted'}>{note}</span>
                </>
              )}
              {raw !== null && <ProviderTextDetail text={raw} />}
              {folded !== null && <TextDetail summary={tAlerts('engineDetail')} text={folded} />}
              {/* Audit des décisions R1, F-1 : adresse hors WABAGENT remplacée sur la WABA, domaine seul (calculé par le moteur). */}
              {check.replaced_host !== undefined && (
                <span data-replaced-host="" className="block text-warning-ink">{t('replacedHost', { host: check.replaced_host })}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
