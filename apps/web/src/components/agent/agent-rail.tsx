'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { StatusPill } from '@/components/agents/status-pill';
import { AGENT_SECTIONS } from './agent-sections';

export function AgentRail({
  botId,
  activeKey,
  agentName,
  status,
}: {
  botId: string;
  activeKey: string;
  agentName: string;
  status: string;
}) {
  const t = useTranslations('agentSpace');
  return (
    <aside className="w-[236px] flex-shrink-0 overflow-auto border-r border-border bg-surface p-[18px_12px]">
      <div className="mb-3 border-b border-border px-2.5 pb-4 pt-1.5">
        <div className="font-serif text-lg leading-tight">{agentName}</div>
        <div className="mt-1.5">
          <StatusPill status={status} />
        </div>
      </div>
      {AGENT_SECTIONS.map((s) => {
        const label = t(s.i18n);
        const isActive = s.key === activeKey;
        const base = 'mb-px flex items-center gap-2.5 rounded-md px-[11px] py-[9px] text-[13.5px]';
        if (s.soon || s.href === null) {
          return (
            <div key={s.key} className={`${base} cursor-default text-muted-2`}>
              <span className="w-4 text-center opacity-80" aria-hidden="true">
                {s.icon}
              </span>
              {label}
              <span className="ml-auto rounded-pill border border-border px-[7px] py-px text-[9.5px] uppercase tracking-wide text-muted-2">
                {t('comingSoon')}
              </span>
            </div>
          );
        }
        const href = s.href === '' ? `/agents/${botId}` : `/agents/${botId}/${s.href}`;
        return (
          <Link
            key={s.key}
            href={href}
            className={`${base} ${
              isActive
                ? 'bg-surface-subtle font-semibold text-fg shadow-[inset_2px_0_0_var(--accent)]'
                : 'text-muted hover:bg-surface-subtle'
            }`}
          >
            <span className="w-4 text-center opacity-80" aria-hidden="true">
              {s.icon}
            </span>
            {label}
          </Link>
        );
      })}
    </aside>
  );
}
