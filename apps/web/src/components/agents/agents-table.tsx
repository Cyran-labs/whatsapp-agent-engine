'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { StatusPill } from './status-pill';
import type { AgentSummaryRow } from '@/lib/onboarding';

function maskNumber(n: string): string {
  if (!n) return '';
  return n.length > 6 ? `${n.slice(0, 5)} •• •• ${n.slice(-2)}` : n;
}

export function AgentsTable({ rows }: { rows: AgentSummaryRow[] }) {
  const t = useTranslations('agents');
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {(['colAgent', 'colStatus', 'colLanguages', 'colNumber', 'colMessages', 'colLeads'] as const).map((k) => (
              <th key={k} className="border-b border-border px-[18px] py-[13px] text-left text-[11px] font-bold uppercase tracking-[1.5px] text-muted-2">{t(k)}</th>
            ))}
            <th className="border-b border-border" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const num = r.numbers[0] ?? '';
            return (
              <tr key={r.bot_id} className="cursor-pointer border-t border-border first:border-t-0 hover:bg-surface-subtle">
                <td className="px-[18px] py-[15px] align-middle">
                  <Link href={`/agents/${r.bot_id}`} className="block">
                    <div className="font-serif text-base text-fg">{r.name}</div>
                    <div className="mt-px font-mono text-[11.5px] text-muted-2">{r.slug}</div>
                  </Link>
                </td>
                <td className="px-[18px] py-[15px]"><StatusPill status={r.status} /></td>
                <td className="px-[18px] py-[15px] text-[13px] text-muted">{r.languages.map((l) => l.toUpperCase()).join(' · ')}</td>
                <td className="px-[18px] py-[15px]">{num ? <span className="font-mono text-[12.5px]">{maskNumber(num)}</span> : <span className="text-muted-2">{t('notConnected')}</span>}</td>
                <td className={`px-[18px] py-[15px] font-semibold ${num ? '' : 'text-muted-2'}`}>{num ? r.messages_total : 0}</td>
                <td className={`px-[18px] py-[15px] font-semibold ${num ? '' : 'text-muted-2'}`}>{num ? r.leads_total : 0}</td>
                <td className="px-[18px] py-[15px] text-right text-base text-muted-2">›</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
