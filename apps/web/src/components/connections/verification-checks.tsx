import { useTranslations } from 'next-intl';
import { VERIFICATION_CHECK_KEYS, type WhatsAppVerificationCheck } from '@wabagent/contracts';
import type { MutationDetail } from '@/lib/api-fetch';

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
  return details.map((d): ShownCheck => (d.message === undefined ? { key: d.path, status: 'failed' } : { key: d.path, status: 'failed', detail: d.message }));
}

const ICON: Record<WhatsAppVerificationCheck['status'], string> = { ok: '✓', created: '✓', pending: '…', failed: '✗' };

/** Une ligne par contrôle de vérification : libellé, état, détail du moteur s'il y en a un. */
export function VerificationChecks({ checks }: { checks: readonly ShownCheck[] }) {
  const t = useTranslations('connections.checks');
  return (
    <ul aria-label={t('listLabel')} className="mt-3 rounded-lg border border-border bg-surface-subtle px-3 py-1">
      {checks.map((check, index) => {
        const note = check.detail ?? (check.status === 'pending' ? t('pending') : check.status === 'created' ? t('created') : null);
        return (
          <li
            key={`${check.key}-${index}`}
            className={`flex items-start gap-2 border-t border-border py-1.5 text-[13px] first:border-t-0 ${check.status === 'failed' ? 'text-danger' : 'text-fg'}`}
          >
            <span aria-hidden="true" className="w-3.5 shrink-0 text-center font-bold">{ICON[check.status]}</span>
            <span>
              <span className="font-semibold">{isCheckKey(check.key) ? t(`keys.${check.key}`) : check.key}</span>
              <span className="sr-only"> : {t(`status.${check.status}`)}</span>
              {note && (
                <>
                  {' '}
                  <span className={check.status === 'failed' ? '' : 'text-muted'}>{note}</span>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
