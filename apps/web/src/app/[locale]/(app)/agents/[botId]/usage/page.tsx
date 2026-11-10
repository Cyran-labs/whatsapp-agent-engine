'use client';
import { use, useEffect, useState } from 'react';
import { failureKind, OrgChangedError, PageFailureView, readOk, type PageFailureKind } from '@/components/agent/page-failure';
import { UsageView } from '@/components/agent/usage-view';
import type { UsageData } from '@/lib/agent-types';
import { apiFetch } from '@/lib/api-fetch';
import { periodStart } from '@/lib/period';

export default function UsagePage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = use(params);
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [failure, setFailure] = useState<PageFailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailure(null);
    apiFetch(`/api/bots/${encodeURIComponent(botId)}/usage?since=${periodStart(period)}`)
      .then((r) => readOk<UsageData>(r))
      .then((u) => {
        if (alive) setUsage(u);
      })
      .catch((err: unknown) => {
        if (!alive || err instanceof OrgChangedError) return;
        setUsage(null);
        setFailure(failureKind(err, 'Usage'));
      });
    return () => {
      alive = false;
    };
  }, [botId, period, attempt]);

  if (failure) return <PageFailureView kind={failure} subject="agentUsage" onRetry={() => setAttempt((n) => n + 1)} />;
  return <UsageView usage={usage} period={period} onPeriod={setPeriod} />;
}
