'use client';
import { use, useEffect, useState } from 'react';
import { failureKind, PageFailureView, readOk, type PageFailureKind } from '@/components/agent/page-failure';
import { Overview, type OverviewData } from '@/components/agent/overview';
import { useReportBot } from '@/components/agent/agent-context';
import type { BotHealth, BotMetrics, BotView, UsageData } from '@/lib/agent-types';
import { apiFetch } from '@/lib/api-fetch';

interface LeadsResp {
  leads: Array<{ phone: string; name: string | null; qualified_data: unknown; last_message_at: string | null }>;
}

export default function OverviewPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = use(params);
  const [data, setData] = useState<OverviewData | null>(null);
  const [failure, setFailure] = useState<PageFailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reportBot = useReportBot();

  useEffect(() => {
    let alive = true;
    setFailure(null);
    Promise.all([
      apiFetch(`/api/bots/${botId}`).then((r) => readOk<BotView>(r)),
      apiFetch(`/api/bots/${botId}/health`).then((r) => readOk<BotHealth>(r)),
      apiFetch(`/api/bots/${botId}/metrics`).then((r) => readOk<BotMetrics>(r)),
      apiFetch(`/api/bots/${botId}/usage`).then((r) => readOk<UsageData>(r)),
      apiFetch(`/api/bots/${botId}/leads?page_size=3`)
        .then((r) => r.json())
        .catch(() => ({ leads: [] })),
    ]).then(([bot, health, metrics, usage, leads]: [BotView, BotHealth, BotMetrics, UsageData, LeadsResp]) => {
      if (!alive) return;
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
    }).catch((err: unknown) => {
      if (!alive) return;
      setData(null);
      setFailure(failureKind(err, 'Overview'));
    });
    return () => {
      alive = false;
    };
  }, [botId, attempt, reportBot]);

  if (failure) return <PageFailureView kind={failure} onRetry={() => setAttempt((n) => n + 1)} />;
  // Un changement de numéro, de statut ou de liste relit toute la page : la santé et le rail en dépendent aussi.
  return <Overview data={data} botId={botId} onChanged={() => setAttempt((n) => n + 1)} />;
}
