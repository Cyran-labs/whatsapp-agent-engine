'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountView, WhatsAppNumberView } from '@wabagent/contracts';
import { RowMenu, type MenuItem } from '@/components/organisation/members-table';
import { formatPhone, whatsAppManagerUrl } from '@/lib/whatsapp-display';
import { AssignBotDialog } from './assign-bot-dialog';
import { TestFlagDialog } from './test-flag-dialog';
import { UnassignDialog } from './unassign-dialog';
import { useReturnFocus } from './use-return-focus';

type Panel = 'assign' | 'unassign' | 'flag';

interface Props {
  account: WhatsAppAccountView;
  number: WhatsAppNumberView;
  /** Relecture de la page et du compteur du rail après une action réussie. */
  onChanged: () => void;
}

/** Menu « ⋯ » d'un numéro et ses fenêtres. Le moteur décide de chaque action ; son refus s'affiche tel quel. */
export function NumberMenu({ account, number, onChanged }: Props) {
  const t = useTranslations('connections.menu');
  const [panel, setPanel] = useState<Panel | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  useReturnFocus(panel, wrapperRef);
  const close = () => setPanel(null);
  const done = () => {
    close();
    onChanged();
  };

  const items: MenuItem[] = [
    { key: 'assign', label: number.bot ? t('change') : t('assign'), onSelect: () => setPanel('assign') },
  ];
  if (number.bot) items.push({ key: 'unassign', label: t('unassign'), onSelect: () => setPanel('unassign') });
  items.push({ key: 'flag', label: number.is_test ? t('unmarkTest') : t('markTest'), onSelect: () => setPanel('flag') });
  if (account.mode === 'meta_manual' && account.waba_id) {
    items.push({ key: 'manager', label: t('manager'), href: whatsAppManagerUrl(account.waba_id), onSelect: () => undefined });
  }

  return (
    <>
      <span ref={wrapperRef} className="inline-block">
        <RowMenu label={t('numberLabel', { number: formatPhone(number.phone_e164) })} items={items} />
      </span>
      {panel === 'assign' && <AssignBotDialog account={account} number={number} onClose={close} onDone={done} />}
      {panel === 'unassign' && number.bot && <UnassignDialog number={number} bot={number.bot} onClose={close} onDone={done} />}
      {panel === 'flag' && <TestFlagDialog account={account} number={number} onClose={close} onDone={done} />}
    </>
  );
}
