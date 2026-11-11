'use client';
import { use, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAgentInfo } from '@/components/agent/agent-context';
import { PageBar } from '@/components/shell/page-bar';
import { ReservedPage } from '@/components/shell/reserved-page';
import { useSession } from '@/components/providers/session-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { PeriodChoice, type Period } from '@/components/usage/period-choice';
import { failureKind, OrgChangedError, PageFailureView, readOk, type PageFailureKind } from '@/components/agent/page-failure';
import { UsageView } from '@/components/agent/usage-view';
import type { UsageData } from '@/lib/agent-types';
import { apiFetch } from '@/lib/api-fetch';
import { periodStart } from '@/lib/period';

export default function UsagePage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = use(params);
  const { isAdmin } = useSession();
  // prototype 5, nav 15.5 : garde propre de la page, en plus de celle de la mise en page de l'agent IA : un non-admin
  // voit le refus sur place, sans lecture des coûts ni choix de période (spec 9.1, 10.4, 10.6).
  if (!isAdmin) return <ReservedPage />;
  return <AgentUsage botId={botId} />;
}

function AgentUsage({ botId }: { botId: string }) {
  const tNav = useTranslations('nav');
  const tSpace = useTranslations('agentSpace');
  const tUsage = useTranslations('usage');
  const agentInfo = useAgentInfo();
  // Période : état de la page, 30 jours par défaut, pas dans l'adresse (choix P-7).
  const [period, setPeriod] = useState<Period>(30);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [failure, setFailure] = useState<PageFailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Nouvelle période : chiffres en squelette, jamais ceux de l'ancienne période.
  const choosePeriod = (p: Period) => {
    if (p === period) return;
    setUsage(null);
    setPeriod(p);
  };

  useEffect(() => {
    let alive = true;
    setFailure(null);
    apiFetch(`/api/bots/${encodeURIComponent(botId)}/usage?since=${encodeURIComponent(periodStart(period))}`)
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

  // Fil « Org › Agents IA › {nom} › Usage et coûts » et titre « Usage et coûts de {nom} » (spec 10.4) ; nom encore en
  // lecture : squelette, jamais un titre sans nom. Le choix de période est l'action principale de la barre.
  const title = agentInfo ? tUsage('agentTitle', { name: agentInfo.name }) : <Skeleton className="h-7 w-72" />;
  const trail = [
    { label: tNav('agents'), href: '/' },
    { label: agentInfo?.name ?? null, href: `/agents/${encodeURIComponent(botId)}` },
    { label: tSpace('usage') },
  ];
  return (
    <>
      <PageBar trail={trail} action={failure ? undefined : <PeriodChoice value={period} onChange={choosePeriod} />} />
      <div className="px-8 py-7">
        {failure ? (
          <PageFailureView kind={failure} subject="agentUsage" onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <UsageView title={title} usage={usage} />
        )}
      </div>
    </>
  );
}
