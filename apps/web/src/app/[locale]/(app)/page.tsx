'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import type { AgentSummaryRow, ChecklistState } from '@/lib/onboarding';
import { SetupBanner } from '@/components/agents/setup-banner';
import { AgentsTable } from '@/components/agents/agents-table';
import { TopBar } from '@/components/shell/top-bar';
import { FirstRun } from '@/components/agents/first-run';

export default function Home() {
  const t = useTranslations('agents');
  const [rows, setRows] = useState<AgentSummaryRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/bots/summary')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (alive) setRows(d as AgentSummaryRow[]); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);

  const list = rows ?? [];
  const hasActive = list.some((r) => r.status === 'active');
  const checklist: ChecklistState = {
    created: list.length > 0,
    personalized: list.some((r) => r.personalized),
    connected: false,
    active: hasActive,
  };

  if (rows !== null && list.length === 0) {
    return (
      <>
        <TopBar variant="root" />
        <main className="p-6">
          <FirstRun />
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar variant="root" activeNav="agents" />
      <main className="overflow-auto p-9">
        <div className="mx-auto max-w-[1000px]">
          {rows !== null && <SetupBanner checklist={checklist} hasActive={hasActive} />}
          <div className="mb-[18px] flex items-end justify-between">
            <div>
              <h1 className="font-serif text-[28px] leading-none text-fg">{t('title')}</h1>
              <div className="mt-1 text-[13px] text-muted-2">{t('count', { count: list.length })}</div>
            </div>
            <Link href="/agents/new" className="rounded-md bg-accent px-[18px] py-2.5 font-bold text-accent-fg hover:bg-accent-hover">{t('create')}</Link>
          </div>
          <AgentsTable rows={list} />
        </div>
      </main>
    </>
  );
}
