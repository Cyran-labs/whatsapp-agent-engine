'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { apiFetch, isOrgChanged } from '@/lib/api-fetch';
import { useRefreshOnVisible } from '@/lib/use-refresh-on-visible';
import { whatsAppManagerUrl } from '@/lib/whatsapp-display';

/** Échecs de remise du numéro lu dans la liste des comptes de l'organisation. */
export type DeliveryState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'ready'; count: number; code: number | null; managerUrl: string | null };

/**
 * Échecs de remise (`delivery_failures`, `last_delivery_error_code`) du numéro branché sur l'agent IA (audit R-6). Le
 * résumé du numéro de l'agent IA ne les porte pas : ils viennent de la liste des comptes de l'organisation, une route
 * d'administration, d'où `enabled` réservé à l'admin. Une lecture en échec reste un échec (`failed`), jamais « aucun
 * échec ». Le numéro n'est cherché que dans le compte que l'agent IA désigne, jamais dans un autre.
 */
export function useDeliveryFailures(number: { id: number; account: { id: number } } | null, enabled: boolean): { state: DeliveryState; retry: () => void } {
  const [state, setState] = useState<DeliveryState>({ phase: 'idle' });
  // Seule la dernière lecture compte ; une réponse arrivée après un changement de numéro ou le démontage est ignorée.
  const sequence = useRef(0);
  const numberId = number?.id ?? null;
  const accountId = number?.account.id ?? null;
  const active = enabled && numberId !== null && accountId !== null;

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    if (!active) {
      setState({ phase: 'idle' });
      return;
    }
    try {
      const res = await apiFetch('/api/whatsapp-accounts');
      if (await isOrgChanged(res)) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const accounts: unknown = await res.json();
      if (!Array.isArray(accounts)) throw new Error('réponse inattendue');
      if (mine !== sequence.current) return;
      const account = (accounts as WhatsAppAccountView[]).find((a) => a.id === accountId);
      const found = account?.numbers.find((n) => n.id === numberId);
      if (!account || !found) {
        setState({ phase: 'idle' });
        return;
      }
      setState({
        phase: 'ready',
        count: found.delivery_failures,
        code: found.last_delivery_error_code,
        managerUrl: account.mode === 'meta_manual' && account.waba_id ? whatsAppManagerUrl(account.waba_id) : null,
      });
    } catch {
      console.error('[Agent] échecs de remise du numéro illisibles');
      // Une relecture en échec garde ce qui était affiché.
      if (mine === sequence.current) setState((previous) => (previous.phase === 'ready' ? previous : { phase: 'failed' }));
    }
  }, [active, accountId, numberId]);

  useEffect(() => {
    setState(active ? { phase: 'loading' } : { phase: 'idle' });
    void load();
    return () => {
      sequence.current += 1;
    };
  }, [active, load]);
  useRefreshOnVisible(() => void load());

  const retry = useCallback(() => {
    setState({ phase: 'loading' });
    void load();
  }, [load]);
  return { state, retry };
}
