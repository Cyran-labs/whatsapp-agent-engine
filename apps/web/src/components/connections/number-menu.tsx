'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountView, WhatsAppNumberView } from '@wabagent/contracts';
import { ActionMenu, type ActionMenuItem } from '@/components/feedback/action-menu';
import { formatPhone, whatsAppManagerUrl } from '@/lib/whatsapp-display';
import { AssignBotDialog } from './assign-bot-dialog';
import { TestFlagDialog } from './test-flag-dialog';
import { UnassignDialog, type UnassignTarget } from './unassign-dialog';
import { useReturnFocus } from './use-return-focus';

type Panel = 'assign' | 'unassign' | 'flag';

interface Props {
  account: WhatsAppAccountView;
  number: WhatsAppNumberView;
  /** Relecture de la page et du compteur du rail après une action réussie. */
  onChanged: () => void;
}

/** Menu « Gérer ▾ » d'un numéro et ses fenêtres. Le moteur décide de chaque action ; son refus s'affiche tel quel. */
export function NumberMenu({ account, number, onChanged }: Props) {
  const t = useTranslations('connections.menu');
  const [panel, setPanel] = useState<Panel | null>(null);
  // Numéro et agent IA tels que l'écran les affichait à l'ouverture de « Débrancher » : figés, la relecture ne les change pas.
  const [unassign, setUnassign] = useState<UnassignTarget | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  useReturnFocus(panel, wrapperRef);
  const close = () => setPanel(null);
  const done = () => {
    close();
    onChanged();
  };

  // Numéro retiré chez le fournisseur : il ne se branche ni ne se change (le moteur le refuse), son marquage de test n'a
  // plus d'objet ; restent « Débrancher » (libérer l'agent IA) et le lien du gestionnaire (revue finale 2b-3 I-3).
  const removed = number.provider_state === 'removed';
  const items: ActionMenuItem[] = [];
  const holder = number.bot;
  if (!removed) {
    const assign = { key: 'assign', label: holder ? t('change') : t('assign'), onSelect: () => setPanel('assign') };
    // Compte de la carte non connecté : un agent IA branché ici ne répondrait pas. L'entrée reste visible, grisée avec
    // cette raison (prototype 17, spec 10.7) ; le moteur accepterait un agent IA Draft ou Offline, la raison ne parle
    // donc pas d'un refus mais de ce qui arriverait (relecture tâche 10, m-6).
    items.push(account.state !== 'connected' ? { ...assign, disabled: true, disabledReason: t('accountNotConnected') } : assign);
  }
  if (holder) {
    items.push({
      key: 'unassign', label: t('unassign'),
      onSelect: () => {
        setUnassign({ number: { id: number.id, phone_e164: number.phone_e164 }, bot: holder });
        setPanel('unassign');
      },
    });
  }
  if (!removed) items.push({ key: 'flag', label: number.is_test ? t('unmarkTest') : t('markTest'), onSelect: () => setPanel('flag') });
  if (account.mode === 'meta_manual' && account.waba_id) {
    items.push({ key: 'manager', label: t('manager'), href: whatsAppManagerUrl(account.waba_id), onSelect: () => undefined });
  }

  return (
    <>
      <span ref={wrapperRef} className="inline-block">
        {items.length > 0 && <ActionMenu subject={formatPhone(number.phone_e164)} items={items} />}
      </span>
      {panel === 'assign' && <AssignBotDialog number={number} onClose={close} onDone={done} onStale={onChanged} />}
      {panel === 'unassign' && unassign && <UnassignDialog target={unassign} onClose={close} onDone={done} onStale={onChanged} />}
      {panel === 'flag' && <TestFlagDialog account={account} number={number} onClose={close} onDone={done} />}
    </>
  );
}
