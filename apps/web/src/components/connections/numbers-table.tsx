'use client';

import { useTranslations } from 'next-intl';
import type { WhatsAppAccountView, WhatsAppNumberView } from '@wabagent/contracts';
import { Link } from '@/i18n/routing';
import { StatusPill } from '@/components/agents/status-pill';
import { TD, TH } from '@/components/organisation/members-table';
import { formatPhone } from '@/lib/whatsapp-display';
import { Health, type HealthTone } from './health';

const QUALITY_TONE: Record<string, HealthTone> = { GREEN: 'success', YELLOW: 'warning', RED: 'danger' };
const KNOWN_META_STATUSES = ['CONNECTED', 'PENDING'];

interface Props {
  account: WhatsAppAccountView;
  /** Relecture de la page après une action sur un numéro (menus ajoutés par la tâche 4). */
  onChanged: () => void;
}

function MetaStatus({ number }: { number: WhatsAppNumberView }) {
  const t = useTranslations('connections.numbers');
  if (number.provider_state === 'removed') {
    return <span className="text-[12.5px] font-semibold text-danger">{t('removed')}</span>;
  }
  const status = number.meta_status;
  if (status === null) return <Health tone="neutral">{t('metaUnknown')}</Health>;
  if (status === 'CONNECTED') return <Health tone="success">{t('metaStatus.CONNECTED')}</Health>;
  return <Health tone="warning">{KNOWN_META_STATUSES.includes(status) ? t(`metaStatus.${status}`) : status}</Health>;
}

function Quality({ number }: { number: WhatsAppNumberView }) {
  const t = useTranslations('connections.numbers.quality');
  if (number.provider_state === 'removed') return <span className="text-muted-2" aria-hidden="true">·</span>;
  const quality = number.quality !== null && Object.hasOwn(QUALITY_TONE, number.quality) ? number.quality : null;
  return (
    <Health tone={quality ? QUALITY_TONE[quality]! : 'neutral'} className="font-normal text-muted">
      {quality ? t(quality) : t('unknown')}
    </Health>
  );
}

function Agent({ number }: { number: WhatsAppNumberView }) {
  const t = useTranslations('connections.numbers');
  if (!number.bot) return <span className="text-[12.5px] text-muted-2">{t('free')}</span>;
  return (
    <Link href={`/agents/${encodeURIComponent(number.bot.bot_id)}`} className="inline-flex items-center gap-2 hover:underline">
      <span className="rounded-pill border border-border bg-surface-subtle px-[9px] py-0.5 text-xs text-fg">{number.bot.name}</span>
      <StatusPill status={number.bot.status} />
    </Link>
  );
}

export function NumbersTable({ account }: Props) {
  const t = useTranslations('connections.numbers');
  if (account.numbers.length === 0) {
    return <p className="px-[18px] py-4 text-[13px] text-muted-2">{t('empty')}</p>;
  }
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th scope="col" className={TH}>{t('colNumber')}</th>
          <th scope="col" className={TH}>{t('colMeta')}</th>
          <th scope="col" className={TH}>{t('colQuality')}</th>
          <th scope="col" className={TH}>{t('colAgent')}</th>
          {/* Colonne réservée au menu d'actions de chaque numéro (tâche 4) : aucun bouton tant qu'il n'a pas d'effet. */}
          <th scope="col" className={`${TH} w-12`}><span className="sr-only">{t('colActions')}</span></th>
        </tr>
      </thead>
      <tbody>
        {account.numbers.map((n) => (
          <tr key={n.id} className="border-t border-border first:border-t-0">
            <td className={TD}>
              <div className={`font-mono text-[13px] ${n.provider_state === 'removed' ? 'text-danger' : ''}`}>{formatPhone(n.phone_e164)}</div>
              <div className="text-xs text-muted-2">{n.display_name}</div>
            </td>
            <td className={TD}><MetaStatus number={n} /></td>
            <td className={TD}><Quality number={n} /></td>
            <td className={TD}><Agent number={n} /></td>
            <td className={`${TD} text-right`} data-slot="number-actions" />
          </tr>
        ))}
      </tbody>
    </table>
  );
}
