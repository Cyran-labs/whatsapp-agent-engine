import { useTranslations } from 'next-intl';
import type { WhatsAppVerificationCheck } from '@wabagent/contracts';
import type { EngineDetail } from './engine-call';

const CHECK_KEYS: readonly WhatsAppVerificationCheck['key'][] = [
  'token', 'waba_access', 'app_secret', 'subscription', 'token_expiry', 'numbers', 'cm_account', 'cm_channels', 'app',
];

function isCheckKey(path: string): path is WhatsAppVerificationCheck['key'] {
  return (CHECK_KEYS as readonly string[]).includes(path);
}

/**
 * Le 422 WA_VALIDATION_FAILED du moteur porte les contrôles en échec dans `error.details` (clé du contrôle en
 * `path`) : chacun redevient un contrôle en échec. Un détail qui n'est pas un contrôle est ignoré.
 */
export function checksFromDetails(details: readonly EngineDetail[]): WhatsAppVerificationCheck[] {
  return details.flatMap((d): WhatsAppVerificationCheck[] => {
    if (!isCheckKey(d.path)) return [];
    return [d.message === undefined ? { key: d.path, status: 'failed' } : { key: d.path, status: 'failed', detail: d.message }];
  });
}

const ICON: Record<WhatsAppVerificationCheck['status'], string> = { ok: '✓', created: '✓', pending: '…', failed: '✗' };

/** Une ligne par contrôle de vérification : libellé, état, détail du moteur s'il y en a un. */
export function VerificationChecks({ checks }: { checks: readonly WhatsAppVerificationCheck[] }) {
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
              <span className="font-semibold">{t(`keys.${check.key}`)}</span>
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
