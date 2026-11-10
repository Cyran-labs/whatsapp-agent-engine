import { useLocale, useTranslations } from 'next-intl';
import { VERIFICATION_CHECK_KEYS, type WhatsAppVerificationCheck } from '@wabagent/contracts';
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
 * Le 422 WA_VALIDATION_FAILED du moteur porte les contrôles en échec dans `error.details` (clé du contrôle en
 * `path`) : chacun redevient un contrôle en échec, y compris un contrôle que ce web ne connaît pas encore.
 */
export function checksFromDetails(details: readonly MutationDetail[]): ShownCheck[] {
  return details.map((d): ShownCheck => ({
    key: d.path,
    status: 'failed',
    ...(d.message === undefined ? {} : { detail: d.message }),
    ...(d.provider_text === undefined ? {} : { provider_text: d.provider_text }),
  }));
}

const ICON: Record<WhatsAppVerificationCheck['status'], string> = { ok: '✓', created: '✓', pending: '…', failed: '✗' };

/**
 * Une ligne par contrôle de vérification : libellé, état, détail du moteur s'il y en a un. Le détail du moteur est en
 * français : en clair en français, replié en anglais sous le statut traduit, comme `AccountErrorSentence` (revue finale M-4).
 */
export function VerificationChecks({ checks }: { checks: readonly ShownCheck[] }) {
  const t = useTranslations('connections.checks');
  const tAlerts = useTranslations('connections.alerts');
  const french = useLocale() === 'fr';
  return (
    <ul aria-label={t('listLabel')} className="mt-3 rounded-lg border border-border bg-surface-subtle px-3 py-1">
      {checks.map((check, index) => {
        // Message du fournisseur (`provider_text`, de l'anglais pour Meta) : une phrase traduite dans la ligne, le texte
        // dans un détail repliable ; sans `provider_text`, le texte du moteur s'affiche tel quel en français (audit R-21).
        const raw = check.provider_text ?? null;
        const engineDetail = raw === null ? (check.detail ?? null) : null;
        // En anglais, le texte du moteur n'est jamais en clair : le statut traduit tient sa place, le texte est replié.
        const folded = !french && engineDetail !== null ? engineDetail : null;
        const note = raw !== null
          ? t('providerRefused')
          : folded !== null
            ? t(`status.${check.status}`)
            : (engineDetail ?? (check.status === 'pending' ? t('pending') : check.status === 'created' ? t('created') : null));
        return (
          <li
            key={`${check.key}-${index}`}
            className={`flex items-start gap-2 border-t border-border py-1.5 text-[13px] first:border-t-0 ${check.status === 'failed' ? 'text-danger' : 'text-fg'}`}
          >
            <span aria-hidden="true" className="w-3.5 shrink-0 text-center font-bold">{ICON[check.status]}</span>
            <span>
              <span className="font-semibold">{isCheckKey(check.key) ? t(`keys.${check.key}`) : check.key}</span>
              {folded === null && <span className="sr-only"> : {t(`status.${check.status}`)}</span>}
              {note && (
                <>
                  {' '}
                  <span className={check.status === 'failed' ? '' : 'text-muted'}>{note}</span>
                </>
              )}
              {raw !== null && <ProviderTextDetail text={raw} />}
              {folded !== null && <TextDetail summary={tAlerts('engineDetail')} text={folded} />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
