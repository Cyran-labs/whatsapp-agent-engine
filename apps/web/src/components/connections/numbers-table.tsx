'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountView, WhatsAppNumberView } from '@wabagent/contracts';
import { Link } from '@/i18n/routing';
import { AgentStatusLine } from '@/components/agents/agent-status-line';
import { TD, TH } from '@/components/organisation/members-table';
import { HintBubble, useHint } from '@/components/shell/coming-soon';
import { Button } from '@/components/ui/button';
import { ANY_DRAFT_BOT, assignRefusal, assignRefusalKey, type AssignRefusalReason } from '@/lib/assign-choice';
import { formatPhone, whatsAppManagerUrl } from '@/lib/whatsapp-display';
import { AssignBotDialog } from './assign-bot-dialog';
import { DeliveryFailures } from './delivery-failures';
import { Health, type HealthTone } from './health';
import { NumberMenu } from './number-menu';

const QUALITY_TONE: Record<string, HealthTone> = { GREEN: 'success', YELLOW: 'warning', RED: 'danger' };
const KNOWN_META_STATUSES = ['CONNECTED', 'PENDING'];

interface Props {
  account: WhatsAppAccountView;
  /** Relecture de la page et du compteur du rail après une action sur un numéro. */
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

/**
 * Numéro libre : « Libre » et un bouton « Brancher » visible (il ouvre la fenêtre que la rangée tient, voir `NumberRow`).
 * Même décision que l'entrée du menu (recette 3.7) : ouvert dès qu'un agent IA Draft pourrait prendre le numéro, compte
 * en erreur compris ; sinon grisé (`aria-disabled`, focalisable), avec la raison des contrats en bulle.
 */
function FreeNumber({ onAssign, refusal }: { onAssign: () => void; refusal: AssignRefusalReason | null }) {
  const t = useTranslations('connections.numbers');
  const tRoot = useTranslations();
  const hint = useHint<HTMLButtonElement>();
  const open = refusal === null;
  return (
    <>
      <span className="text-[12.5px] text-muted-2">{t('free')}</span>
      {/* Nom accessible complet, texte visible court : « Brancher » (recette Q-6). */}
      <Button
        type="button"
        variant="outline"
        aria-label={t('assign')}
        {...(open ? { onClick: onAssign } : { 'aria-disabled': true, ...hint.triggerProps })}
        className="ml-2.5 h-auto border-border-strong px-2.5 py-[5px] text-[12.5px] font-semibold aria-disabled:cursor-not-allowed aria-disabled:text-muted-2 aria-disabled:hover:bg-transparent"
      >
        {t('assignShort')}
      </Button>
      {refusal !== null && <HintBubble id={hint.id} open={hint.open} text={tRoot(assignRefusalKey(refusal))} anchor={hint.anchorRef} />}
    </>
  );
}

/**
 * Agent IA branché : son nom (lien vers sa page), sa pastille, puis son motif d'Offline ou la mention « Ne répond pas »
 * (spec 7.3, point 2), avec l'état affiché du compte de la carte. La mention est hors du lien : sa bulle se lit au focus.
 */
function Agent({ account, number, onAssign }: { account: WhatsAppAccountView; number: WhatsAppNumberView; onAssign: () => void }) {
  if (!number.bot) {
    // Numéro retiré chez le fournisseur : il ne se branche plus, la rangée ne propose rien (revue finale 2b-3 I-3).
    if (number.provider_state === 'removed') return <span className="text-muted-2" aria-hidden="true">·</span>;
    return <FreeNumber onAssign={onAssign} refusal={assignRefusal(ANY_DRAFT_BOT, number, account.state)} />;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/agents/${encodeURIComponent(number.bot.bot_id)}`} className="rounded-pill border border-border bg-surface-subtle px-[9px] py-0.5 text-xs text-fg hover:underline">
        {number.bot.name}
      </Link>
      <AgentStatusLine
        status={number.bot.status}
        statusReason={number.bot.status_reason}
        notResponding={number.bot.not_responding}
        accountState={account.state}
      />
    </div>
  );
}

/**
 * Rangée d'un numéro. La fenêtre « Brancher » ouverte par le bouton « Libre · Brancher » est tenue ici, pas par le bouton :
 * si une relecture montre que le numéro a un détenteur, le bouton disparaît mais la fenêtre reste ouverte, avec le refus
 * du moteur et l'avertissement du nouveau détenteur (revue 2b-3 M-1).
 */
function NumberRow({ account, number: n, onChanged }: { account: WhatsAppAccountView; number: WhatsAppNumberView; onChanged: () => void }) {
  const t = useTranslations('connections.numbers');
  const [assigning, setAssigning] = useState(false);
  return (
    <tr className="border-t border-border first:border-t-0">
      <td className={TD}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`font-mono text-[13px] ${n.provider_state === 'removed' ? 'text-danger' : ''}`}>{formatPhone(n.phone_e164)}</span>
          {n.is_test && n.provider_state !== 'removed' && (
            <span className="rounded-pill border border-border bg-tertiary-soft px-[9px] py-0.5 text-[11.5px] font-semibold text-tertiary-ink">
              {t('testBadge')}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-2">{n.display_name}</div>
        {n.provider_state === 'present' && (
          <DeliveryFailures
            count={n.delivery_failures}
            code={n.last_delivery_error_code}
            managerUrl={account.mode === 'meta_manual' && account.waba_id ? whatsAppManagerUrl(account.waba_id) : null}
          />
        )}
      </td>
      <td className={TD}><MetaStatus number={n} /></td>
      <td className={TD}><Quality number={n} /></td>
      <td className={TD}>
        <Agent account={account} number={n} onAssign={() => setAssigning(true)} />
        {assigning && (
          <AssignBotDialog
            number={n}
            accountState={account.state}
            onClose={() => setAssigning(false)}
            onDone={() => {
              setAssigning(false);
              onChanged();
            }}
            onStale={onChanged}
          />
        )}
      </td>
      <td className={`${TD} text-right`} data-slot="number-actions">
        <NumberMenu account={account} number={n} onChanged={onChanged} />
      </td>
    </tr>
  );
}

export function NumbersTable({ account, onChanged }: Props) {
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
          <th scope="col" className={`${TH} w-12`}><span className="sr-only">{t('colActions')}</span></th>
        </tr>
      </thead>
      <tbody>
        {account.numbers.map((n) => (
          <NumberRow key={n.id} account={account} number={n} onChanged={onChanged} />
        ))}
      </tbody>
    </table>
  );
}
