'use client';
import { use, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/app/[locale]/error';
import { Link } from '@/i18n/routing';
import { Overview, type OverviewData } from '@/components/agent/overview';
import type { BotHealth, BotMetrics, UsageData } from '@/lib/agent-types';
import { apiFetch } from '@/lib/api-fetch';

interface LeadsResp {
  leads: Array<{ phone: string; name: string | null; qualified_data: unknown; last_message_at: string | null }>;
}

/** Réponse du BFF inutilisable : l'état de page qui correspond (404 : agent IA introuvable). */
class PageFailure extends Error {
  constructor(readonly kind: 'notFound' | 'error') {
    super(kind);
  }
}

async function readOk<T>(res: Response): Promise<T> {
  if (res.status === 404) throw new PageFailure('notFound');
  if (!res.ok) throw new PageFailure('error');
  return (await res.json()) as T;
}

export default function OverviewPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = use(params);
  const t = useTranslations('agents');
  const [data, setData] = useState<OverviewData | null>(null);
  const [failure, setFailure] = useState<'notFound' | 'error' | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailure(null);
    Promise.all([
      apiFetch(`/api/bots/${botId}/health`).then((r) => readOk<BotHealth>(r)),
      apiFetch(`/api/bots/${botId}/metrics`).then((r) => readOk<BotMetrics>(r)),
      apiFetch(`/api/bots/${botId}/usage`).then((r) => readOk<UsageData>(r)),
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
    }).catch((err: unknown) => {
      if (!alive) return;
      setData(null);
      if (!(err instanceof PageFailure)) console.error('[Overview] chargement impossible', err);
      setFailure(err instanceof PageFailure ? err.kind : 'error');
    });
    return () => {
      alive = false;
    };
  }, [botId, attempt]);

  if (failure === 'notFound') {
    return (
      <main className="flex flex-col items-center justify-center gap-4 p-10 text-center">
        <h1 className="font-serif text-2xl text-fg">{t('notFound')}</h1>
        <Link href="/" className="text-[13px] underline">{t('notFoundBack')}</Link>
      </main>
    );
  }
  if (failure === 'error') {
    return <ErrorState error={new Error('overview')} reset={() => setAttempt((n) => n + 1)} />;
  }
  return <Overview data={data} botId={botId} />;
}
