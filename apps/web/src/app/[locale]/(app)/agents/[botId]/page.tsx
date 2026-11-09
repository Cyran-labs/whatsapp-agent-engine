'use client';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { failureKind, PageFailureView, readOk, type PageFailureKind } from '@/components/agent/page-failure';
import { Overview, type OverviewData } from '@/components/agent/overview';
import { useReportBot } from '@/components/agent/agent-context';
import type { BotHealth, BotMetrics, BotView, UsageData } from '@/lib/agent-types';
import { apiFetch } from '@/lib/api-fetch';
import { useRefreshOnVisible } from '@/lib/use-refresh-on-visible';

interface LeadsResp {
  leads: Array<{ phone: string; name: string | null; qualified_data: unknown; last_message_at: string | null }>;
}

export default function OverviewPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = use(params);
  const [data, setData] = useState<OverviewData | null>(null);
  const [failure, setFailure] = useState<PageFailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reportBot = useReportBot();
  // Seule la dernière lecture compte : une réponse périmée, ou arrivée après le démontage, est ignorée.
  const sequence = useRef(0);
  const hasData = useRef(false);

  /**
   * Lit l'agent IA et tout ce que la page affiche. `background` : relecture au retour sur l'onglet, sans écran de
   * chargement ; une erreur serveur garde alors les données affichées, un 404 (agent IA supprimé ailleurs) les remplace.
   */
  const load = useCallback(async (background: boolean) => {
    const mine = ++sequence.current;
    if (!background) setFailure(null);
    try {
      const [bot, health, metrics, usage, leads]: [BotView, BotHealth, BotMetrics, UsageData, LeadsResp] = await Promise.all([
        apiFetch(`/api/bots/${botId}`).then((r) => readOk<BotView>(r)),
        apiFetch(`/api/bots/${botId}/health`).then((r) => readOk<BotHealth>(r)),
        apiFetch(`/api/bots/${botId}/metrics`).then((r) => readOk<BotMetrics>(r)),
        apiFetch(`/api/bots/${botId}/usage`).then((r) => readOk<UsageData>(r)),
        apiFetch(`/api/bots/${botId}/leads?page_size=3`)
          .then((r) => r.json())
          .catch(() => ({ leads: [] })),
      ]);
      if (mine !== sequence.current) return;
      hasData.current = true;
      setFailure(null);
      reportBot(bot);
      setData({
        bot,
        health,
        metrics,
        usage,
        // recent.last = nom ou numéro : le texte du dernier message n'est pas
        // disponible dans l'endpoint /leads (liste) ; le détail viendra en 7b.
        recent: (leads.leads ?? []).map((l) => ({
          phone: l.phone,
          name: l.name,
          last: l.name ?? l.phone,
          qualified: !!l.qualified_data,
          when: l.last_message_at ?? '',
        })),
      });
    } catch (err: unknown) {
      if (mine !== sequence.current) return;
      const kind = failureKind(err, 'Overview');
      if (background && hasData.current && kind === 'error') return;
      setData(null);
      setFailure(kind);
    }
  }, [botId, reportBot]);

  useEffect(() => {
    void load(false);
    return () => {
      sequence.current += 1;
    };
  }, [load, attempt]);

  // Activé, mis en pause ou rebranché dans un autre onglet : la page se relit au retour, comme Connexions et l'assistant.
  // Sans cela elle afficherait un statut périmé, et les avertissements de changement de numéro s'appuieraient dessus.
  useRefreshOnVisible(() => void load(true));

  if (failure) return <PageFailureView kind={failure} onRetry={() => setAttempt((n) => n + 1)} />;
  // Un changement de numéro, de statut ou de liste relit toute la page : la santé et le rail en dépendent aussi.
  return <Overview data={data} botId={botId} onChanged={() => setAttempt((n) => n + 1)} />;
}
