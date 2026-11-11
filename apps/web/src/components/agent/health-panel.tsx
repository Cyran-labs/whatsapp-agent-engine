import { useLocale, useTranslations } from 'next-intl';
import type { NotRespondingReason } from '@wabagent/contracts';
import type { BotHealth, BotMetrics } from '@/lib/agent-types';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadError, type RetryState } from '@/components/feedback/load-error';
import { isNumberConnected } from '@/lib/onboarding';
import { formatInteger, type MoneyLocale } from '@/lib/money';
import { FAILED, type Failed } from './panel-ui';

function dotClass(state: 'ok' | 'na' | 'pb') {
  return state === 'ok' ? 'bg-success' : state === 'pb' ? 'bg-danger' : 'bg-neutral';
}

interface Props {
  health: BotHealth | null | Failed;
  metrics: BotMetrics | null | Failed;
  /** Relit la santé, ou les statistiques, dont la lecture a échoué (audit R-17). */
  onRetryHealth: () => void;
  onRetryMetrics: () => void;
  /** Réessai en cours ou en échec de chaque lecture (jamais fourni : aucun réessai en cours). */
  retryHealth?: RetryState;
  retryMetrics?: RetryState;
  /**
   * Mention « Ne répond pas » affichée (filtrée par `shownNotRespondingReason`), nulle sinon : le résumé ne dit alors
   * jamais « tout est opérationnel », il renvoie à l'encart Statut qui écrit le motif (relecture tâche 9).
   */
  notResponding?: NotRespondingReason | null;
}

/**
 * `health` et `metrics` nuls : chargement en cours, titres réels et valeurs en squelette. `FAILED` : la lecture a échoué,
 * « Santé indisponible » ou « Statistiques indisponibles » avec « Réessayer » à la place des valeurs, jamais un état
 * « tout est opérationnel » ni un zéro (audit R-17).
 */
export function HealthPanel({ health: healthRead, metrics: metricsRead, onRetryHealth, onRetryMetrics, retryHealth, retryMetrics, notResponding = null }: Props) {
  const health = healthRead === FAILED ? null : healthRead;
  const metrics = metricsRead === FAILED ? null : metricsRead;
  const t = useTranslations('overview');
  const locale = useLocale() as MoneyLocale;
  // Connecté : un numéro présent chez le fournisseur est branché et son compte WhatsApp est connecté.
  const number = health?.whatsapp?.number ?? null;
  const whatsappOk = isNumberConnected(number);
  const cards = health
    ? [
        { t: t('whatsapp'), s: whatsappOk ? t('connected') : t('notConnected'), d: whatsappOk ? ('ok' as const) : ('pb' as const) },
        { t: t('crm'), s: health.crm.configured ? (health.crm.connector ?? t('connected')) : t('notConnected'), d: health.crm.configured ? ('ok' as const) : ('na' as const) },
        { t: t('ai'), s: `${health.llm.mode === 'platform' ? t('platform') : health.llm.mode}`, d: 'na' as const },
        { t: t('languages'), s: health.languages.map((l) => l.toUpperCase()).join(' · '), d: 'na' as const },
      ]
    : null;
  const hasProblem = cards?.some((c) => c.d === 'pb') ?? false;
  // recette 10 nov. 2026 : un agent IA désactivé ou en brouillon ne répond à personne ; « tout est opérationnel » seul
  // serait trompeur. La phrase d'arrêt passe en premier, la santé technique (compte, numéro) reste dessous.
  const stopped = health?.status === 'paused' ? 'paused' : health?.status === 'draft' ? 'draft' : null;
  const stats = [
    { k: t('statMessages'), v: metrics?.messages_total },
    { k: t('statLeads'), v: metrics?.leads_total },
    { k: t('statAppointments'), v: metrics?.rdv_total },
  ];
  return (
    <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <h3 className="mb-3.5 flex items-baseline justify-between font-serif text-base font-normal">
        {t('healthTitle')}
        {cards ? (
          notResponding !== null ? (
            <span className="font-sans text-[11px] font-semibold text-danger-ink">{t('healthNotResponding')}</span>
          ) : (
            (stopped === null || hasProblem) && (
              <span className={`font-sans text-[11px] ${hasProblem ? 'text-danger' : 'text-muted-2'}`}>{hasProblem ? t('healthAttention') : t('healthAllOk')}</span>
            )
          )
        ) : (
          healthRead !== FAILED && <Skeleton className="h-3 w-24" />
        )}
      </h3>
      {healthRead === FAILED ? (
        <LoadError message={t('healthUnavailable')} onRetry={onRetryHealth} retry={retryHealth} />
      ) : (
      <>
        {stopped !== null && <p className="mb-3 text-[12.5px] font-semibold text-warning-ink">{t(`healthStopped.${stopped}`)}</p>}
        <div className="grid grid-cols-2 gap-2.5">
          {cards
            ? cards.map((c, i) => (
                <div key={i} className="flex items-center gap-2.5 rounded-lg border border-border p-[11px]">
                  <span className={`h-[9px] w-[9px] flex-shrink-0 rounded-full ${dotClass(c.d)}`} aria-hidden="true" />
                  <div>
                    <div className="text-[13px] font-semibold">{c.t}</div>
                    <div className="text-[11.5px] text-muted-2">{c.s}</div>
                  </div>
                </div>
              ))
            : [0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2.5 rounded-lg border border-border p-[11px]">
                  <Skeleton className="h-[9px] w-[9px] shrink-0 rounded-full" />
                  <div className="flex-1">
                    <Skeleton className="h-3.5 w-20" />
                    <Skeleton className="mt-1 h-3 w-24" />
                  </div>
                </div>
              ))}
        </div>
      </>
      )}
      {metricsRead === FAILED ? (
        <div className="mt-3">
          <LoadError message={t('metricsUnavailable')} onRetry={onRetryMetrics} retry={retryMetrics} />
        </div>
      ) : (
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {stats.map((s, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface-subtle p-3">
            <div className="text-[10.5px] uppercase tracking-wide text-muted-2">{s.k}</div>
            {s.v === undefined ? <Skeleton className="mt-1.5 h-6 w-12 bg-surface" /> : <div className="mt-0.5 font-serif text-2xl">{formatInteger(s.v, locale)}</div>}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
