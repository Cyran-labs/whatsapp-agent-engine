'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import type { EntitySummary } from '@/lib/entities';
import type { AgentSummaryRow } from '@/lib/onboarding';
import { DialogFrame } from './dialog-frame';

interface Props {
  entity: EntitySummary;
  /** Agents IA encore rattachés à l'entité. */
  agents: AgentSummaryRow[];
  onClose: () => void;
  onMoveAgent: (botId: string) => void;
  /** Envoie l'archivage ; renvoie le message d'erreur du moteur, ou null en cas de succès. */
  onConfirm: () => Promise<string | null>;
}

const GHOST = 'h-auto border-border-strong px-[15px] py-2 text-[13px] font-normal';
const BLOCK = 'mb-2.5 rounded-lg border border-border';
const BLOCK_TITLE = 'flex items-center justify-between border-b border-border px-3 py-[9px] text-xs font-bold uppercase tracking-[0.6px] text-muted-2';
const LINK = 'text-[12.5px] font-semibold text-accent-ink';

export function ArchiveEntityDialog({ entity, agents, onClose, onMoveAgent, onConfirm }: Props) {
  const t = useTranslations('organisation.entities.archive');
  const te = useTranslations('organisation.entities');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const hasAgents = agents.length > 0;
  const hasMembers = entity.members > 0;
  const blocked = hasAgents || hasMembers;

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const err = await onConfirm();
    busyRef.current = false;
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <DialogFrame title={t('title', { name: entity.name })} onClose={onClose}>
      {blocked ? (
        <>
          <p className="mb-3.5 text-[13px] text-muted">
            {hasAgents && hasMembers ? t('blockedBoth') : hasAgents ? t('blockedAgents') : t('blockedMembers')}
          </p>
          {hasAgents && (
            <div className={BLOCK}>
              <div className={BLOCK_TITLE}>{t('agentsBlock')} <span>{agents.length}</span></div>
              {agents.map((a) => (
                <div key={a.bot_id} className="flex items-center justify-between border-t border-border px-3 py-2 text-[13px] first:border-t-0">
                  {a.name}
                  <button type="button" onClick={() => onMoveAgent(a.bot_id)} className={LINK}>{t('moveAgent')}</button>
                </div>
              ))}
            </div>
          )}
          {hasMembers && (
            <div className={BLOCK}>
              <div className={BLOCK_TITLE}>{t('membersBlock')} <span>{entity.members}</span></div>
              <div className="flex items-center justify-between px-3 py-2 text-[13px]">
                {t('membersHint')}
                <Link href={`/organisation/utilisateurs?entity=${entity.id}`} className={LINK}>
                  {t('membersLink', { count: entity.members })}
                </Link>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="mb-3.5 text-[13px] text-muted">{t('confirmText')}</p>
      )}

      {error && <p role="alert" className="mb-2 text-[12.5px] text-danger">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} className={GHOST}>
          {blocked ? t('close') : te('cancel')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={blocked || busy}
          onClick={confirm}
          className="h-auto border-[#F3C4C4] px-[15px] py-2 text-[13px] font-normal text-[#a32020] dark:border-[#7a2a2a] dark:text-[#F3A8A8]"
        >
          {t('confirm')}
        </Button>
      </div>
    </DialogFrame>
  );
}
