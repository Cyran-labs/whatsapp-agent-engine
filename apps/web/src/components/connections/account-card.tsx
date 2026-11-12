'use client';

import { useRef, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import type { WhatsAppAccountStateView, WhatsAppAccountView } from '@wabagent/contracts';
import { AccountAlerts } from './account-alerts';
import { credentialsLock } from './account-error';
import { AccountMenu } from './account-menu';
import { AccountRunDialog } from './account-run-dialog';
import { Health, type HealthTone } from './health';
import { NumbersTable } from './numbers-table';
import { AccountWebhook } from './account-webhook';
import { AccountWebhooks } from './account-webhooks';
import { ReplaceCredentialsDialog } from './replace-credentials-dialog';
import { useReturnFocus } from './use-return-focus';

const STATE_TONE: Record<WhatsAppAccountStateView, HealthTone> = {
  connected: 'success',
  error: 'danger',
  disconnected: 'neutral',
};

interface Props {
  account: WhatsAppAccountView;
  /** Relecture de la page et du compteur du rail après une action sur le compte ou sur l'un de ses numéros. */
  onChanged: () => void;
  /** Compte retiré depuis son menu : la page notifie, le range avec les comptes retirés et se relit. */
  onRemoved: (account: WhatsAppAccountView, repointedTo: string | null) => void;
  /** Instant de référence des durées affichées ; l'heure courante par défaut. */
  now?: Date;
  /** Incrémentée par la page à chaque relecture : le webhook (route dédiée, CM.com) se relit avec elle. */
  refreshKey: number;
  /** Administrateur de l'organisation, et lecture seule : « Faire pointer vers WABAGENT » seulement pour `isAdmin && !readOnly`. */
  isAdmin: boolean;
  readOnly: boolean;
}

/**
 * Bloc d'un compte WhatsApp : en-tête, numéros, bandeaux d'alerte, puis l'état des webhooks et du compte lu chez Meta
 * (compte Meta) ou la boîte webhook à copier (CM.com).
 */
export function AccountCard({ account, onChanged, onRemoved, now, refreshKey, isAdmin, readOnly }: Props) {
  const t = useTranslations('connections.account');
  const format = useFormatter();
  const reference = now ?? new Date();
  // « Remplacer les identifiants » ou « Vérifier maintenant » demandé par le bandeau d'erreur ; le focus revient au menu
  // « Gérer » du compte à la fermeture.
  const [panel, setPanel] = useState<'credentials' | 'verify' | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  useReturnFocus(panel, actionsRef);
  const close = () => setPanel(null);
  // Même fenêtre de vérification que le menu « Gérer », aux mêmes conditions (recette 3.6, choix C-12) : identifiants
  // illisibles (le moteur refuse de les remplacer) ou compte qui ne peut pas être raccordé (recette K-6), la fenêtre ne
  // propose pas de les remplacer.
  const locked = credentialsLock(account) !== null;

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
          <div ref={actionsRef} data-slot="account-actions" className="flex min-h-[30px] min-w-[30px] items-center justify-end">
            <AccountMenu account={account} onChanged={onChanged} onRemoved={(repointedTo) => onRemoved(account, repointedTo)} />
          </div>
        </div>
      </header>
      <NumbersTable account={account} onChanged={onChanged} />
      <AccountAlerts account={account} now={reference} onReplaceCredentials={() => setPanel('credentials')} onVerify={() => setPanel('verify')} />
      {/* Spec R1 §6.2 : pour un compte Meta, WABAGENT inscrit lui-même ses webhooks, il n'y a rien à copier ; la route du
          webhook répond 404 et n'est pas lue. Le bloc dit l'état calculé par le moteur. */}
      {account.mode === 'meta_manual' && (account.webhooks !== null || account.meta_health !== null) && (
        <div className="border-t border-border px-[18px] py-3">
          <AccountWebhooks
            webhooks={account.webhooks}
            metaHealth={account.meta_health}
            accountId={account.id}
            isAdmin={isAdmin}
            readOnly={readOnly}
            onChanged={onChanged}
            onVerify={() => setPanel('verify')}
          />
        </div>
      )}
      {/* CM.com : la liste des comptes ne porte aucun secret, la boîte lit le webhook sur la route dédiée (revue 2b-3 M-2).
          Un compte retiré n'a plus de webhook : la boîte n'est pas montée, la route n'est pas lue (recette Q-8). */}
      {account.mode === 'cm_com' && account.state !== 'disconnected' && <AccountWebhook accountId={account.id} refreshKey={refreshKey} />}
      {panel === 'credentials' && <ReplaceCredentialsDialog account={account} onClose={close} onDone={onChanged} />}
      {panel === 'verify' && (
        <AccountRunDialog
          kind="verify"
          account={account}
          onClose={close}
          onDone={onChanged}
          onReplaceCredentials={locked ? undefined : () => setPanel('credentials')}
        />
      )}
    </section>
  );
}
