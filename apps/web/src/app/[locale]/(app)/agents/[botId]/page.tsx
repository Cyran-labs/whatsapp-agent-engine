'use client';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { failureKind, OrgChangedError, PageFailureView, readOk, type PageFailureKind } from '@/components/agent/page-failure';
import { NOT_READ, Overview, type OverviewData, type PanelKey } from '@/components/agent/overview';
import type { RetryState } from '@/components/feedback/load-error';
import { FAILED, type Failed } from '@/components/agent/panel-ui';
import { StaleBanner } from '@/components/feedback/stale-banner';
import { useReportBot } from '@/components/agent/agent-context';
import { useSession } from '@/components/providers/session-provider';
import type { BotHealth, BotMetrics, BotView, UsageData } from '@/lib/agent-types';
import { apiFetch } from '@/lib/api-fetch';
import { useRefreshOnVisible } from '@/lib/use-refresh-on-visible';

interface LeadsResp {
  leads: Array<{ phone: string; name: string | null; qualified_data: unknown; last_message_at: string | null }>;
}

/**
 * Lecture d'un panneau : sa valeur, ou `FAILED` si elle échoue (audit R-17). Seul le 409 ORG_CHANGED traverse : il
 * arrête toute la lecture (apiFetch recharge la page). Une erreur inattendue (réseau) est journalisée par `failureKind`.
 */
async function readPanel<T>(read: Promise<T>): Promise<T | Failed> {
  try {
    return await read;
  } catch (err: unknown) {
    if (err instanceof OrgChangedError) throw err;
    failureKind(err, 'Overview');
    return FAILED;
  }
}

/** Lecteurs des panneaux, un par route : chacun a sa propre lecture, donc son propre échec et son propre « Réessayer ». */
const PANEL_READERS: { [K in PanelKey]: (path: string) => Promise<OverviewData[K] | Failed> } = {
  health: (path) => readPanel(apiFetch(`/api/bots/${path}/health`).then((r) => readOk<BotHealth>(r))),
  metrics: (path) => readPanel(apiFetch(`/api/bots/${path}/metrics`).then((r) => readOk<BotMetrics>(r))),
  usage: (path) => readPanel(apiFetch(`/api/bots/${path}/usage`).then((r) => readOk<UsageData>(r))),
  recent: (path) =>
    readPanel(
      apiFetch(`/api/bots/${path}/leads?page_size=3`)
        .then((r) => readOk<LeadsResp>(r))
        // recent.last = nom ou numéro : le texte du dernier message n'est pas disponible dans l'endpoint /leads
        // (liste) ; le détail viendra en 7b.
        .then((leads) =>
          (leads.leads ?? []).map((l) => ({
            phone: l.phone,
            name: l.name,
            last: l.name ?? l.phone,
            qualified: !!l.qualified_data,
            when: l.last_message_at ?? '',
          })),
        ),
    ),
};

const IDLE: Record<PanelKey, RetryState> = {
  health: { busy: false, failures: 0 },
  metrics: { busy: false, failures: 0 },
  usage: { busy: false, failures: 0 },
  recent: { busy: false, failures: 0 },
};

export default function OverviewPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = use(params);
  // Identifiant texte de l'agent IA : encodé dans chaque chemin d'API (revue finale 2b-3 m-8) ; les panneaux enfants
  // reçoivent l'identifiant brut et l'encodent eux-mêmes.
  const path = encodeURIComponent(botId);
  const [data, setData] = useState<OverviewData | null>(null);
  const [failure, setFailure] = useState<PageFailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Réessai de chaque panneau : lecture en cours, et échecs de réessai depuis l'affichage du panneau.
  const [retryStates, setRetryStates] = useState(IDLE);
  // Réessai en cours de chaque panneau : son numéro d'ordre, ou null. Remis à null chaque fois que la page réécrit ses
  // données (relecture complète, changement d'agent IA, démontage) : un réessai ancien n'agit plus et n'empêche pas le suivant.
  const retryRun = useRef<Record<PanelKey, number>>({ health: 0, metrics: 0, usage: 0, recent: 0 });
  const retryActive = useRef<Record<PanelKey, number | null>>({ health: null, metrics: null, usage: null, recent: null });
  // Compte les réécritures des données de la page : un réessai ne vaut que si la page n'a pas été réécrite depuis son départ.
  const dataEpoch = useRef(0);
  const resetRetries = useCallback(() => {
    dataEpoch.current += 1;
    retryActive.current = { health: null, metrics: null, usage: null, recent: null };
    setRetryStates(IDLE);
  }, []);
  // Relecture en arrière-plan en échec : les données affichées restent, avec un bandeau (revue finale 2b-3 m-3).
  // `stale` : une écriture a réussi depuis la dernière lecture, le bandeau dit qu'elle est enregistrée (audit R-19) ;
  // `plain` : aucune écriture, la page peut seulement être périmée.
  const [reloadFailed, setReloadFailed] = useState<'plain' | 'stale' | null>(null);
  const t = useTranslations('overview');
  const reportBot = useReportBot();
  // Coûts réservés à l'admin (spec refonte de la navigation, 9.1) : un autre membre ne fait pas l'appel à `/usage`.
  const { isAdmin } = useSession();
  // Seule la dernière lecture compte : une réponse périmée, ou arrivée après le démontage, est ignorée.
  const sequence = useRef(0);
  const hasData = useRef(false);
  const wroteSinceRead = useRef(false);

  /**
   * Lit l'agent IA et tout ce que la page affiche. `background` : relecture au retour sur l'onglet, sans écran de
   * chargement ; une erreur serveur garde alors les données affichées, un 404 (agent IA supprimé ailleurs) les remplace.
   * Seule la lecture de l'agent IA fait tomber la page : chaque autre panneau échoue seul (audit R-17).
   */
  const load = useCallback(async (background: boolean) => {
    const mine = ++sequence.current;
    if (!background) setFailure(null);
    try {
      const [bot, health, metrics, usage, recent] = await Promise.all([
        apiFetch(`/api/bots/${path}`).then((r) => readOk<BotView>(r)),
        PANEL_READERS.health(path),
        PANEL_READERS.metrics(path),
        isAdmin ? PANEL_READERS.usage(path) : NOT_READ,
        PANEL_READERS.recent(path),
      ]);
      if (mine !== sequence.current) return;
      hasData.current = true;
      wroteSinceRead.current = false;
      // Toute la page vient d'être relue : les réessais de panneau en cours n'ont plus d'objet (leur réponse sera ignorée).
      resetRetries();
      setFailure(null);
      setReloadFailed(null);
      reportBot(bot);
      setData({ bot, health, metrics, usage, recent });
    } catch (err: unknown) {
      // 409 ORG_CHANGED : apiFetch recharge la page, rien à afficher.
      if (mine !== sequence.current || err instanceof OrgChangedError) return;
      const kind = failureKind(err, 'Overview');
      if (background && hasData.current && kind === 'error') {
        setReloadFailed(wroteSinceRead.current ? 'stale' : 'plain');
        return;
      }
      resetRetries();
      setData(null);
      setFailure(kind);
    }
  }, [path, reportBot, resetRetries, isAdmin]);

  /**
   * Relit un seul panneau en échec ; les autres ne bougent pas. Un seul réessai à la fois par panneau (le bouton est
   * désactivé pendant la lecture) ; la réponse d'un réessai que la page a dépassé (relecture complète) est ignorée ; un
   * réessai en échec laisse le panneau en échec et le dit (« Nouvel essai en échec. »).
   */
  const retryPanel = useCallback(async (panel: PanelKey) => {
    if (retryActive.current[panel] !== null) return;
    const run = ++retryRun.current[panel];
    retryActive.current[panel] = run;
    const epoch = dataEpoch.current;
    setRetryStates((previous) => ({ ...previous, [panel]: { ...previous[panel], busy: true } }));
    const value = await PANEL_READERS[panel](path).catch((err: unknown) => {
      if (err instanceof OrgChangedError) return null;
      throw err;
    });
    // La page a été réécrite pendant la lecture (relecture complète, autre agent IA, démontage) : cette réponse est
    // dépassée, l'état de réessai a déjà été remis à zéro. Une relecture en arrière-plan en échec ne compte pas : les
    // données affichées n'ont pas changé, le réessai garde sa valeur.
    if (epoch !== dataEpoch.current || retryActive.current[panel] !== run) return;
    retryActive.current[panel] = null;
    setRetryStates((previous) => ({
      ...previous,
      [panel]: { busy: false, failures: value === null ? previous[panel].failures : value === FAILED ? previous[panel].failures + 1 : 0 },
    }));
    if (value === null) return;
    setData((previous) => (previous === null ? previous : { ...previous, [panel]: value }));
  }, [path]);

  useEffect(() => {
    void load(false);
    return () => {
      sequence.current += 1;
      resetRetries();
    };
  }, [load, attempt, resetRetries]);

  // Activé, mis en pause ou rebranché dans un autre onglet : la page se relit au retour, comme Connexions et l'assistant.
  // Sans cela elle afficherait un statut périmé, et les avertissements de changement de numéro s'appuieraient dessus.
  useRefreshOnVisible(() => void load(true));

  if (failure) return <PageFailureView kind={failure} subject="agent" onRetry={() => setAttempt((n) => n + 1)} />;
  // Un changement de numéro, de statut ou de liste relit toute la page : la santé et le rail en dépendent aussi. La
  // relecture se fait en arrière-plan : si elle échoue, l'action a réussi et les données restent affichées avec un message.
  return (
    <>
      {reloadFailed === 'stale' && (
        <div className="mx-auto max-w-[1000px]">
          <StaleBanner onRetry={() => void load(true)} />
        </div>
      )}
      {reloadFailed === 'plain' && (
        <div role="alert" className="mx-auto mb-3 flex max-w-[1000px] items-center gap-3 rounded-lg bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger-ink">
          <span>{t('reloadFailed')}</span>
          <button type="button" onClick={() => void load(true)} className="ml-auto rounded-md border border-border-strong bg-surface px-3 py-1 text-[12.5px] font-semibold text-fg hover:bg-surface-subtle">
            {t('retry')}
          </button>
        </div>
      )}
      <Overview
        data={data}
        botId={botId}
        onChanged={() => {
          wroteSinceRead.current = true;
          void load(true);
        }}
        onStale={() => void load(true)}
        onRetryPanel={(panel) => void retryPanel(panel)}
        retryStates={retryStates}
      />
    </>
  );
}
