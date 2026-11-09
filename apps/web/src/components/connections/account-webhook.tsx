'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountModeView, WhatsAppWebhookView } from '@wabagent/contracts';
import { apiFetch, isOrgChanged } from '@/lib/api-fetch';
import { CancelButton, ErrorLine } from './dialog-ui';
import { WebhookBox } from './webhook-box';

type Reading = { phase: 'loading' } | { phase: 'failed' } | { phase: 'ready'; webhook: WhatsAppWebhookView };

function isWebhook(value: unknown): value is WhatsAppWebhookView {
  if (typeof value !== 'object' || value === null) return false;
  const { path, url, verify_token: token } = value as Record<string, unknown>;
  return typeof path === 'string' && (url === null || typeof url === 'string') && (token === null || typeof token === 'string');
}

interface Props {
  accountId: number;
  mode: WhatsAppAccountModeView;
  /** Change à chaque relecture de la page : le webhook se relit avec elle. */
  refreshKey: number;
}

/**
 * Boîte webhook d'un compte de la page Connexions. La clé d'URL et le jeton de vérification ne figurent pas dans la
 * liste des comptes : la boîte les lit seule, sur la route dédiée du compte (revue 2b-3 M-2). Une relecture garde
 * le webhook déjà affiché jusqu'à la réponse.
 */
export function AccountWebhook({ accountId, mode, refreshKey }: Props) {
  const t = useTranslations('connections.webhook');
  const [reading, setReading] = useState<Reading>({ phase: 'loading' });
  // Seule la dernière lecture compte ; une réponse arrivée après le démontage est ignorée.
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    try {
      const res = await apiFetch(`/api/whatsapp-accounts/${accountId}/webhook`);
      if (await isOrgChanged(res)) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: unknown = await res.json();
      if (!isWebhook(body)) throw new Error('réponse inattendue');
      if (mine === sequence.current) setReading({ phase: 'ready', webhook: body });
    } catch (err: unknown) {
      console.error('[Connections] webhook du compte illisible', err);
      if (mine === sequence.current) setReading((previous) => (previous.phase === 'ready' ? previous : { phase: 'failed' }));
    }
  }, [accountId]);

  useEffect(() => {
    void load();
    return () => {
      sequence.current += 1;
    };
  }, [load, refreshKey]);

  if (reading.phase === 'ready') return <WebhookBox webhook={reading.webhook} mode={mode} />;

  return (
    <div className="border-t border-border bg-surface px-[18px] py-3.5">
      {reading.phase === 'loading' ? (
        <p aria-busy="true" className="text-xs text-muted-2">{t('loading')}</p>
      ) : (
        <>
          <ErrorLine>{t('loadFailed')}</ErrorLine>
          <div className="mt-2">
            <CancelButton onClick={() => { setReading({ phase: 'loading' }); void load(); }}>{t('retry')}</CancelButton>
          </div>
        </>
      )}
    </div>
  );
}
