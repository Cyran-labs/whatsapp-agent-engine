'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { Link } from '@/i18n/routing';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StaleBanner } from '@/components/feedback/stale-banner';
import { useNotify } from '@/components/feedback/notification-provider';
import { failureKind, PageFailure, PageFailureView, type PageFailureKind } from '@/components/agent/page-failure';
import { AccountCard } from '@/components/connections/account-card';
import { CrmComing } from '@/components/connections/crm-coming';
import { Health } from '@/components/connections/health';
import { useOrganisationCounts } from '@/components/organisation/organisation-counts';
import { apiFetch, isOrgChanged } from '@/lib/api-fetch';
import { useRefreshOnVisible } from '@/lib/use-refresh-on-visible';
import { cn } from '@/lib/utils';

const CONNECT_HREF = '/organisation/connexions/raccorder';
const CONNECT_CLASS = 'h-auto px-[15px] py-2 text-[13px] font-bold';
const SECTION_LABEL = 'mb-2.5 mt-1 text-[11px] font-bold uppercase tracking-[1.5px] text-accent-ink';

function AccountSkeleton() {
  return (
    <div data-skeleton-account="" className="mb-4 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-3.5 border-b border-border px-[18px] py-3.5">
        <div>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-1.5 h-3 w-64" />
        </div>
        <Skeleton className="ml-auto h-4 w-24" />
      </div>
      {[0, 1].map((row) => (
        <div key={row} className="flex items-center gap-6 border-t border-border px-[18px] py-3 first:border-t-0">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-[22px] w-28 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export default function ConnexionsPage() {
  const t = useTranslations('connections');
  const notify = useNotify();
  const { reportConnectionCount } = useOrganisationCounts();
  // null : en cours de chargement (ou 409 ORG_CHANGED : la page se recharge d'elle-même).
  const [loaded, setLoaded] = useState<{ accounts: WhatsAppAccountView[]; at: Date } | null>(null);
  const [failure, setFailure] = useState<PageFailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  // Relecture en échec après une lecture réussie : les données précédentes restent affichées avec un bandeau. `stale` :
  // une écriture a réussi depuis la dernière lecture (« Modification enregistrée… », audit §5.1) ; `plain` : aucune.
  const [reloadFailed, setReloadFailed] = useState<'plain' | 'stale' | null>(null);
  const hasLoaded = useRef(false);
  const wroteSinceRead = useRef(false);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/whatsapp-accounts')
      .then(async (res) => {
        if (await isOrgChanged(res)) return;
        if (!res.ok) throw new PageFailure('error');
        const list = (await res.json()) as WhatsAppAccountView[];
        if (alive) {
          hasLoaded.current = true;
          setFailure(null);
          setReloadFailed(null);
          wroteSinceRead.current = false;
          setLoaded({ accounts: list, at: new Date() });
          // Le rail reçoit ce que cette lecture vient de montrer, il ne relit pas la route.
          reportConnectionCount(list.filter((a) => a.state !== 'disconnected').length);
        }
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const kind = failureKind(err, 'Connections');
        if (hasLoaded.current) setReloadFailed(wroteSinceRead.current ? 'stale' : 'plain');
        else setFailure(kind);
      });
    return () => {
      alive = false;
    };
  }, [attempt, reloadKey, reportConnectionCount]);

  /** Relit les comptes (sans repasser par les squelettes) ; le compteur du rail suit cette lecture. */
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  /** Après une écriture réussie sur un compte ou un numéro : si la relecture échoue, le bandeau le dit (audit §5.1). */
  const onChanged = useCallback(() => {
    wroteSinceRead.current = true;
    reload();
  }, [reload]);

  /**
   * Compte retiré de WABAGENT : la réussite est notifiée (audit R-19) et le compte passe tout de suite dans « Comptes
   * retirés », sans attendre la relecture : sa carte, et donc la lecture de son webhook, disparaissent (recette Q-8).
   */
  const onRemoved = useCallback(
    (account: WhatsAppAccountView) => {
      notify.success(t('disconnect.done', { name: account.name }));
      setLoaded((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              accounts: previous.accounts.map((a) =>
                a.id === account.id ? { ...a, state: 'disconnected', error_reason: null, error_detail: null, is_test: false, alerts: [], numbers: [] } : a,
              ),
            },
      );
      onChanged();
    },
    [notify, t, onChanged],
  );

  // Un numéro branché ou raccordé dans un autre onglet : la page et le compteur du rail se relisent au retour, comme
  // l'assistant (revue 2b-3 M-1).
  useRefreshOnVisible(reload);

  const accounts = loaded?.accounts ?? null;

  if (failure) {
    return (
      <PageFailureView
        kind={failure}
        subject="connections"
        onRetry={() => {
          setFailure(null);
          setLoaded(null);
          hasLoaded.current = false;
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  const live = (accounts ?? []).filter((a) => a.state !== 'disconnected');
  const disconnected = (accounts ?? []).filter((a) => a.state === 'disconnected');
  const empty = accounts !== null && live.length === 0;
  const connectLink = (
    <Link href={CONNECT_HREF} className={cn(buttonVariants(), CONNECT_CLASS)}>
      {t('connect')}
    </Link>
  );

  return (
    <>
      <div className="mb-[18px] flex items-start justify-between gap-6">
        <div>
          <h1 className="font-serif text-[26px] font-normal leading-[1.1] text-fg">{t('title')}</h1>
          <p className="mt-[5px] max-w-[600px] text-[12.5px] text-muted-2">{t('subtitle')}</p>
        </div>
        {!empty && connectLink}
      </div>

      {reloadFailed === 'stale' && <StaleBanner onRetry={reload} />}
      {reloadFailed === 'plain' && (
        <div role="alert" className="mb-3 flex items-center gap-3 rounded-lg bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger-ink">
          <span>{t('reloadFailed')}</span>
          <Button type="button" variant="outline" onClick={reload} className="ml-auto h-auto px-3 py-1 text-[12.5px] font-semibold">
            {t('retry')}
          </Button>
        </div>
      )}

      <div className={SECTION_LABEL}>{t('sectionWhatsapp')}</div>

      {accounts === null && (
        <>
          <AccountSkeleton />
          <AccountSkeleton />
        </>
      )}

      {empty && (
        <div className="mb-4 flex flex-col items-start gap-3 rounded-xl border border-border bg-surface px-[18px] py-6 shadow-sm">
          <h2 className="font-serif text-lg text-fg">{t('emptyTitle')}</h2>
          <p className="max-w-[520px] text-[13px] text-muted-2">{t('emptyText')}</p>
          {connectLink}
        </div>
      )}

      {live.map((account) => (
        <AccountCard key={account.id} account={account} onChanged={onChanged} onRemoved={onRemoved} now={loaded?.at} refreshKey={reloadKey + attempt} />
      ))}

      {disconnected.length > 0 && (
        <details className="mb-4 rounded-xl border border-border bg-surface px-[18px] py-3 text-[13px]">
          <summary className="cursor-pointer text-muted">{t('disconnected.summary', { count: disconnected.length })}</summary>
          <ul className="mt-2.5">
            {disconnected.map((account) => (
              <li key={account.id} className="flex items-center gap-3 border-t border-border py-2 first:border-t-0">
                <span className="font-serif text-[15px] text-fg">{account.name}</span>
                <span className="text-xs text-muted-2">
                  {account.mode === 'meta_manual' ? t('account.modeMeta') : t('account.modeCm')}
                </span>
                <Health tone="neutral" className="ml-auto">{t('account.state.disconnected')}</Health>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className={cn(SECTION_LABEL, 'mt-[22px]')}>{t('crm.title')}</div>
      <CrmComing />
    </>
  );
}
