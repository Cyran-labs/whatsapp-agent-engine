'use client';

import { useTranslations, useFormatter } from 'next-intl';
import type { WhatsAppAccountStateView, WhatsAppAccountView } from '@wabagent/contracts';
import { AccountAlerts } from './account-alerts';
import { AccountMenu } from './account-menu';
import { Health, type HealthTone } from './health';
import { NumbersTable } from './numbers-table';
import { WebhookBox } from './webhook-box';

const STATE_TONE: Record<WhatsAppAccountStateView, HealthTone> = {
  connected: 'success',
  error: 'danger',
  disconnected: 'neutral',
};

interface Props {
  account: WhatsAppAccountView;
  /** Relecture de la page et du compteur du rail après une action sur le compte ou sur l'un de ses numéros. */
  onChanged: () => void;
  /** Instant de référence des durées affichées ; l'heure courante par défaut. */
  now?: Date;
}

/** Bloc d'un compte WhatsApp : en-tête, numéros, bandeaux d'alerte et boîte webhook. */
export function AccountCard({ account, onChanged, now }: Props) {
  const t = useTranslations('connections.account');
  const format = useFormatter();
  const reference = now ?? new Date();

  return (
    <section aria-labelledby={`account-${account.id}`} className="mb-4 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <header className="flex items-center gap-3.5 border-b border-border px-[18px] py-3.5">
        <div className="min-w-0">
          <h2 id={`account-${account.id}`} className="font-serif text-lg leading-tight text-fg">{account.name}</h2>
          <p className="mt-0.5 text-xs text-muted-2">
            {account.mode === 'meta_manual' ? t('modeMeta') : t('modeCm')}
            {account.waba_id && (
              <>
                {' · '}
                {t('waba')} <code className="font-mono text-[11.5px] text-muted">{account.waba_id}</code>
              </>
            )}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          {account.is_test && (
            <span className="rounded-pill border border-border bg-tertiary-soft px-[9px] py-0.5 text-[11.5px] font-semibold text-tertiary-ink">
              {t('testBadge')}
            </span>
          )}
          <Health tone={STATE_TONE[account.state]}>{t(`state.${account.state}`)}</Health>
          <span className="text-xs text-muted-2">
            {account.last_verified_at
              ? t('verified', { when: format.relativeTime(new Date(account.last_verified_at), reference) })
              : t('neverVerified')}
          </span>
          <div data-slot="account-actions" className="flex min-h-[30px] min-w-[30px] items-center justify-end">
            <AccountMenu account={account} onChanged={onChanged} />
          </div>
        </div>
      </header>
      <NumbersTable account={account} onChanged={onChanged} />
      <AccountAlerts account={account} now={reference} />
      <WebhookBox webhook={account.webhook} mode={account.mode} />
    </section>
  );
}
