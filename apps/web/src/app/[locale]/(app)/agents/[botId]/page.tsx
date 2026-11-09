'use client';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { failureKind, OrgChangedError, PageFailureView, readOk, type PageFailureKind } from '@/components/agent/page-failure';
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
  // Identifiant texte de l'agent IA : encodé dans chaque chemin d'API (revue finale 2b-3 m-8) ; les panneaux enfants
  // reçoivent l'identifiant brut et l'encodent eux-mêmes.
  const path = encodeURIComponent(botId);
  const [data, setData] = useState<OverviewData | null>(null);
  const [failure, setFailure] = useState<PageFailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Relecture en arrière-plan en échec : les données affichées restent, avec un message (revue finale 2b-3 m-3).
  const [reloadFailed, setReloadFailed] = useState(false);
  const t = useTranslations('overview');
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
        apiFetch(`/api/bots/${path}`).then((r) => readOk<BotView>(r)),
        apiFetch(`/api/bots/${path}/health`).then((r) => readOk<BotHealth>(r)),
        apiFetch(`/api/bots/${path}/metrics`).then((r) => readOk<BotMetrics>(r)),
        apiFetch(`/api/bots/${path}/usage`).then((r) => readOk<UsageData>(r)),
        apiFetch(`/api/bots/${path}/leads?page_size=3`)
          .then((r) => r.json())
          .catch(() => ({ leads: [] })),
      ]);
      if (mine !== sequence.current) return;
      hasData.current = true;
      setFailure(null);
      setReloadFailed(false);
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
      // 409 ORG_CHANGED : apiFetch recharge la page, rien à afficher.
      if (mine !== sequence.current || err instanceof OrgChangedError) return;
      const kind = failureKind(err, 'Overview');
      if (background && hasData.current && kind === 'error') {
        setReloadFailed(true);
        return;
      }
      setData(null);
      setFailure(kind);
    }
  }, [path, reportBot]);

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
  // Un changement de numéro, de statut ou de liste relit toute la page : la santé et le rail en dépendent aussi. La
  // relecture se fait en arrière-plan : si elle échoue, l'action a réussi et les données restent affichées avec un message.
  return (
    <>
      {reloadFailed && (
        <div role="alert" className="mx-auto mb-3 flex max-w-[1000px] items-center gap-3 rounded-lg bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger-ink">
          <span>{t('reloadFailed')}</span>
          <button type="button" onClick={() => void load(true)} className="ml-auto rounded-md border border-border-strong bg-surface px-3 py-1 text-[12.5px] font-semibold text-fg hover:bg-surface-subtle">
            {t('retry')}
          </button>
        </div>
      )}
      <Overview data={data} botId={botId} onChanged={() => void load(true)} />
    </>
  );
}
