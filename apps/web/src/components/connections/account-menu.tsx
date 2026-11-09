'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { RowMenu, type MenuItem } from '@/components/organisation/members-table';
import { AccountRunDialog, type RunKind } from './account-run-dialog';
import { DisconnectDialog } from './disconnect-dialog';
import { RenameAccountDialog } from './rename-account-dialog';
import { ReplaceCredentialsDialog } from './replace-credentials-dialog';
import { useReturnFocus } from './use-return-focus';

type Panel = 'rename' | 'credentials' | 'disconnect' | RunKind;

interface Props {
  account: WhatsAppAccountView;
  /** Relecture de la page et du compteur du rail après une action réussie. */
  onChanged: () => void;
}

/** Menu « ⋯ » d'un compte WhatsApp et ses fenêtres. Le moteur décide de chaque action ; son refus s'affiche tel quel. */
export function AccountMenu({ account, onChanged }: Props) {
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
    { key: 'rename', label: t('rename'), onSelect: () => setPanel('rename') },
    { key: 'credentials', label: t('credentials'), onSelect: () => setPanel('credentials') },
    { key: 'verify', label: t('verify'), onSelect: () => setPanel('verify') },
    { key: 'refresh', label: t('refresh'), onSelect: () => setPanel('refresh') },
    { key: 'disconnect', label: t('disconnect'), onSelect: () => setPanel('disconnect'), danger: true },
  ];

  return (
    <>
      <span ref={wrapperRef} className="inline-block">
        <RowMenu label={t('accountLabel', { name: account.name })} items={items} />
      </span>
      {panel === 'rename' && <RenameAccountDialog account={account} onClose={close} onDone={done} />}
      {/* Remplacement, vérification, rafraîchissement : la fenêtre reste ouverte sur le résultat, la page se relit. */}
      {panel === 'credentials' && <ReplaceCredentialsDialog account={account} onClose={close} onDone={onChanged} />}
      {(panel === 'verify' || panel === 'refresh') && <AccountRunDialog kind={panel} account={account} onClose={close} onDone={onChanged} />}
      {panel === 'disconnect' && <DisconnectDialog account={account} onClose={close} onDone={done} />}
    </>
  );
}
