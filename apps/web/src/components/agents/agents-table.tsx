'use client';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { AgentStatusLine } from './agent-status-line';
import type { AgentSummaryRow } from '@/lib/onboarding';
import { formatPhone } from '@/lib/whatsapp-display';
import { SkeletonRows, type SkeletonCell } from '@/components/ui/skeleton';
import { PartialValue } from '@/components/feedback/partial-value';
import { formatInteger, type MoneyLocale } from '@/lib/money';


/**
 * Numéro de l'agent IA en entier pour tous (spec 8) : c'est le numéro de la société, pas une donnée personnelle.
 * `entityNames` fourni : la colonne Entité est affichée (plusieurs entités actives, aucune filtrée).
 * `rows` nul : chargement en cours, en-tête réel et lignes squelettes.
 * Toute la ligne mène à la page de l'agent IA, flèche comprise (recette 3.12, C-19) : le nom reste le seul lien (un
 * arrêt du clavier par ligne, nom lu par les lecteurs d'écran), son `::after` couvre la ligne, qui est son bloc de
 * référence (`relative`). Tout autre élément actif de la ligne passe au-dessus (`relative z-10`, marques de « Ne répond
 * pas ») et garde son effet.
 */
export function AgentsTable({ rows, entityNames }: { rows: AgentSummaryRow[] | null; entityNames?: Map<number, string> }) {
  const t = useTranslations('agents');
  const locale = useLocale() as MoneyLocale;
  const columns = (['colAgent', ...(entityNames ? ['colEntity'] : []), 'colStatus', 'colLanguages', 'colNumber', 'colMessages', 'colLeads'] as const);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((k) => (
              <th key={k} className="border-b border-border px-[18px] py-[13px] text-left text-[11px] font-bold uppercase tracking-[1.5px] text-muted-2">{t(k)}</th>
            ))}
            <th className="border-b border-border" />
          </tr>
        </thead>
        <tbody>
          {rows === null && (
            <SkeletonRows
              cells={['title', ...(entityNames ? ['pill' as const] : []), 'pill', 'line', 'line', 'line', 'line', 'none'] satisfies SkeletonCell[]}
              cellClassName="px-[18px] py-[15px] align-middle"
            />
          )}
          {rows?.map((r) => {
            const num = r.number ?? '';
            return (
              <tr key={r.bot_id} className="relative border-t border-border first:border-t-0 hover:bg-surface-subtle">
                <td className="px-[18px] py-[15px] align-middle">
                  <Link href={`/agents/${encodeURIComponent(r.bot_id)}`} className="block after:absolute after:inset-0 after:content-['']">
                    <div className="font-serif text-base text-fg">{r.name}</div>
                    <div className="mt-px font-mono text-[11.5px] text-muted-2">{r.slug}</div>
                  </Link>
                </td>
                {entityNames && (
                  <td className="px-[18px] py-[15px]">
                    {entityNames.get(r.entity_id) && (
                      <span className="inline-block rounded-pill border border-border bg-surface-subtle px-[9px] py-0.5 text-xs text-muted">{entityNames.get(r.entity_id)}</span>
                    )}
                  </td>
                )}
                <td className="px-[18px] py-[15px]">
                  <AgentStatusLine status={r.status} statusReason={r.status_reason} notResponding={r.not_responding} accountState={r.account_state} />
                </td>
                <td className="px-[18px] py-[15px] text-[13px] text-muted">{r.languages.map((l) => l.toUpperCase()).join(' · ')}</td>
                <td className="px-[18px] py-[15px]">{num ? <span className="font-mono text-[12.5px]">{formatPhone(num)}</span> : <span className="text-muted-2">{t('notConnected')}</span>}</td>
                <td className="px-[18px] py-[15px] font-semibold">{r.messages_total === null ? <PartialValue /> : formatInteger(r.messages_total, locale)}</td>
                <td className="px-[18px] py-[15px] font-semibold">{r.leads_total === null ? <PartialValue /> : formatInteger(r.leads_total, locale)}</td>
                <td className="px-[18px] py-[15px] text-right text-base text-muted-2">›</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
