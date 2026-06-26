import { useTranslations } from 'next-intl';
import type { BotHealth, BotMetrics } from '@/lib/agent-types';

function dotClass(state: 'ok' | 'na' | 'pb') {
  return state === 'ok' ? 'bg-success' : state === 'pb' ? 'bg-danger' : 'bg-neutral';
}

export function HealthPanel({ health, metrics }: { health: BotHealth; metrics: BotMetrics }) {
  const t = useTranslations('overview');
  const cards = [
    { t: t('whatsapp'), s: health.whatsapp.validated ? t('connected') : t('notConnected'), d: health.whatsapp.validated ? ('ok' as const) : ('pb' as const) },
    { t: t('crm'), s: health.crm.configured ? (health.crm.connector ?? t('connected')) : t('notConnected'), d: health.crm.configured ? ('ok' as const) : ('na' as const) },
    { t: t('ai'), s: `${health.llm.mode === 'platform' ? t('platform') : health.llm.mode}`, d: 'na' as const },
    { t: t('languages'), s: health.languages.map((l) => l.toUpperCase()).join(' · '), d: 'na' as const },
  ];
  const hasProblem = cards.some((c) => c.d === 'pb');
  return (
    <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <h3 className="mb-3.5 flex items-baseline justify-between font-serif text-base font-normal">
        {t('healthTitle')}
        <span className={`font-sans text-[11px] ${hasProblem ? 'text-danger' : 'text-muted-2'}`}>{hasProblem ? t('healthAttention') : t('healthAllOk')}</span>
      </h3>
      <div className="grid grid-cols-2 gap-2.5">
        {cards.map((c, i) => (
          <div key={i} className="flex items-center gap-2.5 rounded-lg border border-border p-[11px]">
            <span className={`h-[9px] w-[9px] flex-shrink-0 rounded-full ${dotClass(c.d)}`} aria-hidden="true" />
            <div>
              <div className="text-[13px] font-semibold">{c.t}</div>
              <div className="text-[11.5px] text-muted-2">{c.s}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {[
          { k: t('statMessages'), v: metrics.messages_total },
          { k: t('statLeads'), v: metrics.leads_total },
          { k: t('statQualified'), v: metrics.rdv_total },
        ].map((s, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface-subtle p-3">
            <div className="text-[10.5px] uppercase tracking-wide text-muted-2">{s.k}</div>
            <div className="mt-0.5 font-serif text-2xl">{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
