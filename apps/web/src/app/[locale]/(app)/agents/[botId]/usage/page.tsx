'use client';
import { use, useEffect, useState } from 'react';
import { UsageView } from '@/components/agent/usage-view';
import type { UsageData } from '@/lib/agent-types';

function sinceFor(days: number): string {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

export default function UsagePage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = use(params);
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const [usage, setUsage] = useState<UsageData | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/bots/${botId}/usage?since=${sinceFor(period)}`)
      .then((r) => r.json())
      .then((u: UsageData) => {
        if (alive) setUsage(u);
      })
      .catch(() => {
        if (alive) setUsage(null);
      });
    return () => {
      alive = false;
    };
  }, [botId, period]);

  if (!usage) return <div className="text-sm text-muted-2">…</div>;
  return <UsageView usage={usage} period={period} onPeriod={setPeriod} />;
}
