'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TopBar } from '@/components/shell/top-bar';
import { UsageSummaryTable } from '@/components/usage/usage-summary-table';

interface Summary {
  rows: Array<{
    bot_id: string;
    name: string;
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  }>;
  total: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  };
}

export default function GlobalUsagePage() {
  const t = useTranslations('usage');
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/usage/summary')
      .then((r) => r.json())
      .then((d: Summary) => { if (alive) setS(d); })
      .catch(() => { if (alive) setS(null); });
    return () => { alive = false; };
  }, []);
  return (
    <>
      <TopBar active="usage" />
      <main className="overflow-auto p-9">
        <div className="mx-auto max-w-[1000px]">
          <h1 className="mb-5 font-serif text-[28px] font-normal">{t('globalTitle')}</h1>
          {s && <UsageSummaryTable rows={s.rows} total={s.total} />}
        </div>
      </main>
    </>
  );
}
