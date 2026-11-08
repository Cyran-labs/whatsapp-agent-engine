'use client';
import { use, useEffect, useState } from 'react';
import { Overview, type OverviewData } from '@/components/agent/overview';
import type { BotHealth, BotMetrics, UsageData } from '@/lib/agent-types';
import { apiFetch } from '@/lib/api-fetch';

interface LeadsResp {
  leads: Array<{ phone: string; name: string | null; qualified_data: unknown; last_message_at: string | null }>;
}

export default function OverviewPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = use(params);
  const [data, setData] = useState<OverviewData | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiFetch(`/api/bots/${botId}/health`).then((r) => r.json()),
      apiFetch(`/api/bots/${botId}/metrics`).then((r) => r.json()),
      apiFetch(`/api/bots/${botId}/usage`).then((r) => r.json()),
      apiFetch(`/api/bots/${botId}/leads?page_size=3`)
        .then((r) => r.json())
        .catch(() => ({ leads: [] })),
    ]).then(([health, metrics, usage, leads]: [BotHealth, BotMetrics, UsageData, LeadsResp]) => {
      if (!alive) return;
      setData({
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
    }).catch(() => {
      if (alive) setData(null);
    });
    return () => {
      alive = false;
    };
  }, [botId]);

  if (!data) return <div className="text-sm text-muted-2">…</div>;
  return <Overview data={data} botId={botId} />;
}
