'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountCreated } from '@wabagent/contracts';
import { Link } from '@/i18n/routing';
import { buttonVariants } from '@/components/ui/button';
import { formatPhone } from '@/lib/whatsapp-display';
import { cn } from '@/lib/utils';
import { AccountWebhooks } from './account-webhooks';
import { VerificationChecks } from './verification-checks';
import { WebhookBox } from './webhook-box';

const CONNECTIONS_HREF = '/organisation/connexions';

/**
 * Résultat d'un raccordement réussi : contrôles du fournisseur (dont les deux webhooks inscrits chez Meta), état des
 * webhooks et du compte lu chez Meta, numéros trouvés, bilan des refus. CM.com seulement : la boîte webhook du nouveau
 * compte, à copier chez CM.com (spec R1 §6.2 : pour Meta, `webhook` est null, WABAGENT l'a inscrit lui-même).
 */
export function ConnectResult({ account }: { account: WhatsAppAccountCreated }) {
  const t = useTranslations('connections.connectFlow.result');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const isMeta = account.mode === 'meta_manual';
  // Spec R1 §2 : aucune recopie manuelle en repli pour Meta, même si une réponse portait encore un webhook.
  const showWebhook = !isMeta && account.webhook !== null;
  const found = account.numbers.filter((n) => n.provider_state === 'present');
  const { refused } = account.inventory;

  // Le formulaire vient de disparaître : le focus passe au résultat.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <section className="max-w-[640px] rounded-xl border border-border bg-surface shadow-sm">
      <div className="px-[18px] py-4">
        <h2 ref={titleRef} tabIndex={-1} className="font-serif text-xl font-normal text-fg focus-visible:outline-none">
          {t('title')}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-muted-2">{account.name}</p>
        <p className="mt-3 text-[13px] text-muted">{t('intro', { provider: isMeta ? t('providerMeta') : t('providerCm') })}</p>
        <VerificationChecks checks={account.checks} />
        {/* Lecture seule ici : « Faire pointer vers WABAGENT » et « Vérifier maintenant » sont sur la carte du compte. */}
        {(account.webhooks !== null || account.meta_health !== null) && (
          <div className="mt-3">
            <AccountWebhooks webhooks={account.webhooks} metaHealth={account.meta_health} accountId={account.id} isAdmin readOnly />
          </div>
        )}

        <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-3.5 py-3">
          <h3 className="text-[13px] font-semibold text-fg">{t('found', { count: found.length })}</h3>
          {found.length === 0 ? (
            <p className="mt-1 text-xs text-muted-2">{t('noNumbers')}</p>
          ) : (
            <ul aria-label={t('foundLabel')} className="mt-1.5">
              {found.map((number) => (
                <li key={number.id} className="flex items-baseline gap-3 border-t border-border py-1.5 text-[13px] first:border-t-0">
                  <span className="font-mono font-semibold text-fg">{formatPhone(number.phone_e164)}</span>
                  <span className="text-muted">{number.display_name}</span>
                </li>
              ))}
            </ul>
          )}
          {refused > 0 && <p className="mt-2 text-xs text-warning-ink">{t('refused', { count: refused })}</p>}
        </div>

        {showWebhook && <p className="mt-4 text-[13px] font-semibold text-fg">{t('webhookCm')}</p>}
      </div>
      {showWebhook && account.webhook !== null && <WebhookBox webhook={account.webhook} />}
      <div className="flex items-center justify-between gap-3 border-t border-border px-[18px] py-3.5">
        <span className="text-xs text-muted-2">{t('next')}</span>
        <Link href={CONNECTIONS_HREF} className={cn(buttonVariants(), 'h-auto px-[15px] py-2 text-[13px] font-bold')}>
          {t('finish')}
        </Link>
      </div>
    </section>
  );
}
