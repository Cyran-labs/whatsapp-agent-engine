'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountStateView } from '@wabagent/contracts';
import { AccountErrorSentence } from '@/components/connections/account-alerts';
import { DeliveryFailures } from '@/components/connections/delivery-failures';
import { UnassignDialog, type UnassignTarget } from '@/components/connections/unassign-dialog';
import type { BotView } from '@/lib/agent-types';
import { Link } from '@/i18n/routing';
import { maskNumber } from '@/lib/mask-number';
import { formatPhone } from '@/lib/whatsapp-display';
import { AssignNumberDialog } from './assign-number-dialog';
import { ACTION, Card } from './panel-ui';

interface Props {
  bot: BotView;
  /** Admin hors lecture seule : brancher, changer, débrancher. */
  canEdit: boolean;
  /** Admin : le numéro de l'organisation s'affiche en entier ; ailleurs, il est masqué. */
  seeFull: boolean;
  /** Admin : seul à pouvoir ouvrir Connexions, donc seul à voir le lien vers cet écran. Indépendant de l'affichage du numéro. */
  canOpenConnections: boolean;
  /** Relecture de la page après un branchement ou un débranchement enregistré. */
  onChanged: () => void;
  /** Relecture après un refus « ce numéro a changé » (rien n'a été enregistré) ; `onChanged` à défaut. */
  onStale?: () => void;
}

const STATE_TONE: Record<WhatsAppAccountStateView, string> = {
  connected: 'bg-success-soft text-success-ink',
  error: 'bg-danger-soft text-danger-ink',
  disconnected: 'bg-surface-subtle text-muted-2',
};
const TAG = 'whitespace-nowrap rounded-pill px-2 py-0.5 text-[11px] font-semibold';

type Panel = 'assign' | 'unassign' | null;

/** Numéro WhatsApp de l'agent IA : branché, compte et son état. Le moteur décide de chaque branchement. */
export function NumberPanel({ bot, canEdit, seeFull, canOpenConnections, onChanged, onStale }: Props) {
  const t = useTranslations('agentNumber');
  const tc = useTranslations('connections');
  const headingId = useId();
  const [panel, setPanel] = useState<Panel>(null);
  // Numéro affiché à l'ouverture de « Débrancher » : figé, la relecture de la page ne le change pas (revue finale 2b-3 I-2).
  const [unassign, setUnassign] = useState<UnassignTarget | null>(null);
  const number = bot.whatsapp_number;
  const done = () => {
    setPanel(null);
    onChanged();
  };

  return (
    <Card title={t('title')} labelledBy={headingId}>
      {number === null ? (
        <>
          <p className="text-[13px] text-muted">{t('none')}</p>
          {canEdit && (
            <button type="button" onClick={() => setPanel('assign')} className={`mt-3 ${ACTION}`}>{t('assign')}</button>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-[15px] text-fg">{seeFull ? formatPhone(number.phone_e164) : maskNumber(number.phone_e164)}</span>
            {number.is_test && number.provider_state !== 'removed' && <span className={`${TAG} border border-border bg-tertiary-soft text-tertiary-ink`}>{tc('numbers.testBadge')}</span>}
            {number.provider_state === 'removed' && <span className={`${TAG} bg-danger-soft text-danger-ink`}>{tc('numbers.removed')}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-2">
            <span>{t('account', { name: number.account.name })}</span>
            <span className={`${TAG} ${STATE_TONE[number.account.state]}`}>{tc(`account.state.${number.account.state}`)}</span>
          </div>
          {/* contre-audit D-1 (audit §5.1, état durable repris là où l'objet est utilisé) : cause, conséquence, action. Le moteur
              ne sert aucun message reçu tant que le compte n'est pas connecté (src/core/router.ts, verdict `account_error`). */}
          {number.account.state === 'error' && (
            <div role="alert" className="mt-2.5 rounded-lg bg-danger-soft px-3 py-2.5 text-[12.5px] text-danger-ink">
              <p><AccountErrorSentence account={number.account} /></p>
              <p className="mt-1 font-semibold">{t('accountError.consequence')}</p>
              <p className="mt-1">
                {canOpenConnections ? (
                  <Link href="/organisation/connexions" className="font-semibold underline">{t('accountError.openConnections')}</Link>
                ) : (
                  t('accountError.contactAdmin')
                )}
              </p>
            </div>
          )}
          {/* audit R-6 : un numéro retiré chez le fournisseur n'envoie plus rien, ses échecs n'auraient plus de sens. Le lien
              vers Connexions (où l'on agit) est réservé à l'admin (`canOpenConnections`), seul à pouvoir l'ouvrir. */}
          {number.provider_state === 'present' && (
            <DeliveryFailures
              count={number.delivery_failures}
              code={number.last_delivery_error_code}
              managerUrl={null}
              action={canOpenConnections ? { href: '/organisation/connexions', label: t('deliveryLink') } : undefined}
            />
          )}
          {canEdit && (
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setPanel('assign')} className={ACTION}>{t('change')}</button>
              <button
                type="button"
                onClick={() => {
                  setUnassign({ number: { id: number.id, phone_e164: number.phone_e164 }, bot: { bot_id: bot.bot_id, name: bot.name, status: bot.status } });
                  setPanel('unassign');
                }}
                className={ACTION}
              >
                {t('unassign')}
              </button>
            </div>
          )}
        </>
      )}

      {panel === 'assign' && <AssignNumberDialog botId={bot.bot_id} bot={bot} currentNumber={number} onClose={() => setPanel(null)} onDone={done} />}
      {panel === 'unassign' && unassign !== null && (
        <UnassignDialog target={unassign} onClose={() => setPanel(null)} onDone={done} onStale={onStale ?? onChanged} staleMessage={t('unassignStale')} />
      )}
    </Card>
  );
}
