'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { EntitySummary } from '@/lib/entities';
import type { AgentSummaryRow } from '@/lib/onboarding';
import { InlineError } from '@/components/feedback/inline-error';
import type { DescribedFailure } from '@/lib/describe-failure';
import { DialogFrame } from './dialog-frame';

interface Props {
  source: EntitySummary;
  /** Agents IA de l'entité source. */
  agents: AgentSummaryRow[];
  /** Entités actives, hors source. */
  targets: EntitySummary[];
  initialBotId?: string;
  onClose: () => void;
  /** Envoie le déplacement ; renvoie le refus à afficher dans la fenêtre, ou null en cas de succès. */
  onSubmit: (botId: string, entityId: number) => Promise<DescribedFailure | null>;
}

const SELECT = 'w-full rounded-lg border border-border-strong bg-surface px-[13px] py-2.5 text-[13.5px] text-fg';
const LABEL = 'mb-1.5 block text-[13px] font-semibold';

export function MoveAgentDialog({ source, agents, targets, initialBotId, onClose, onSubmit }: Props) {
  const t = useTranslations('organisation.entities.move');
  const te = useTranslations('organisation.entities');
  const tc = useTranslations('common');
  const agentId = useId();
  const targetId = useId();
  const [botId, setBotId] = useState(initialBotId ?? agents[0]?.bot_id ?? '');
  const [entityId, setEntityId] = useState<number | null>(targets[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<DescribedFailure | null>(null);

  const target = targets.find((e) => e.id === entityId);

  async function submit() {
    if (busyRef.current || !botId || entityId === null) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const err = await onSubmit(botId, entityId);
    busyRef.current = false;
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <DialogFrame title={t('title')} onClose={onClose} busy={busy}>
      <p className="mb-3.5 text-[13px] text-muted">{t('text', { source: source.name })}</p>

      <label htmlFor={agentId} className={LABEL}>{t('agentLabel')}</label>
      <select id={agentId} value={botId} onChange={(e) => setBotId(e.target.value)} className={SELECT}>
        {agents.map((a) => <option key={a.bot_id} value={a.bot_id}>{a.name}</option>)}
      </select>

      <label htmlFor={targetId} className={`${LABEL} mt-3.5`}>{t('targetLabel')}</label>
      <select id={targetId} value={entityId ?? ''} onChange={(e) => setEntityId(Number(e.target.value))} className={SELECT}>
        {targets.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      {target && <p className="mt-1.5 text-[11.5px] text-muted-2">{t('hint', { target: target.name })}</p>}

      {error && <div className="mt-2"><InlineError message={error.message} reference={error.reference} /></div>}

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={busy} title={busy ? tc('sending') : undefined} onClick={onClose} className="h-auto border-border-strong px-[15px] py-2 text-[13px] font-normal">
          {te('cancel')}
        </Button>
        <Button type="button" disabled={busy || !botId || entityId === null} onClick={submit} className="h-auto px-[15px] py-2 text-[13px] font-bold">
          {t('confirm')}
        </Button>
      </div>
    </DialogFrame>
  );
}
