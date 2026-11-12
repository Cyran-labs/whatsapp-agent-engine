'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { ActionMenu, type ActionMenuItem } from '@/components/feedback/action-menu';
import { credentialsLock } from './account-error';
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
  /** Compte retiré (204) : la page notifie, le range avec les comptes retirés et se relit. */
  onRemoved: () => void;
}

/** Menu « Gérer ▾ » d'un compte WhatsApp et ses fenêtres. Le moteur décide de chaque action ; son refus s'affiche tel quel. */
export function AccountMenu({ account, onChanged, onRemoved }: Props) {
  const t = useTranslations('connections.menu');
  const [panel, setPanel] = useState<Panel | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  useReturnFocus(panel, wrapperRef);
  const close = () => setPanel(null);
  const done = () => {
    close();
    onChanged();
  };
  const removed = () => {
    close();
    onRemoved();
  };

  // audit décisions A23 : des identifiants enregistrés illisibles (cause `reconnect`, décidée par le moteur) ne se
  // remplacent pas et ne permettent pas de lire les numéros : le moteur refuse les deux (409
  // `whatsapp_account.secrets_unreadable`) ; les deux entrées le disent avant toute action. Recette K-6 : de même pour un
  // compte qui ne peut pas être raccordé (cause `support`), que seul le support débloque. « Vérifier maintenant » reste
  // actif : il répond, et le compte reste en erreur avec ce motif.
  const lock = credentialsLock(account);
  const lockReason = lock === 'unreadable' ? t('credentialsUnreadable') : t('credentialsSupport');
  const items: ActionMenuItem[] = [
    { key: 'rename', label: t('rename'), onSelect: () => setPanel('rename') },
    lock
      ? { key: 'credentials', label: t('credentials'), onSelect: () => undefined, disabled: true, disabledReason: lockReason }
      : { key: 'credentials', label: t('credentials'), onSelect: () => setPanel('credentials') },
    { key: 'verify', label: t('verify'), onSelect: () => setPanel('verify') },
    lock
      ? { key: 'refresh', label: t('refresh'), onSelect: () => undefined, disabled: true, disabledReason: lockReason }
      : { key: 'refresh', label: t('refresh'), onSelect: () => setPanel('refresh') },
    { key: 'disconnect', label: t('disconnect'), onSelect: () => setPanel('disconnect'), danger: true },
  ];

  return (
    <>
      <span ref={wrapperRef} className="inline-block">
        <ActionMenu subject={account.name} items={items} />
      </span>
      {panel === 'rename' && <RenameAccountDialog account={account} onClose={close} onDone={done} />}
      {/* Remplacement, vérification, rafraîchissement : la fenêtre reste ouverte sur le résultat, la page se relit. */}
      {panel === 'credentials' && <ReplaceCredentialsDialog account={account} onClose={close} onDone={onChanged} />}
      {(panel === 'verify' || panel === 'refresh') && (
        <AccountRunDialog
          kind={panel}
          account={account}
          onClose={close}
          onDone={onChanged}
          onReplaceCredentials={lock ? undefined : () => setPanel('credentials')}
        />
      )}
      {panel === 'disconnect' && <DisconnectDialog account={account} onClose={close} onDone={removed} />}
    </>
  );
}
