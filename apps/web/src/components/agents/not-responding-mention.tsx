'use client';
import { useTranslations } from 'next-intl';
import type { NotRespondingReason, WhatsAppAccountStateView } from '@wabagent/contracts';
import { HintBubble, useHint } from '@/components/shell/coming-soon';
import { notRespondingTextKey } from '@/lib/status-words';
import { MENTION_STYLE } from './status-style';

/**
 * Mention « Ne répond pas » (spec 7), lue du champ `not_responding` du moteur, jamais recalculée ici. `short` : texte
 * court rouge à droite de la pastille, le motif dans une bulle au survol et au focus clavier (liste, Connexions,
 * colonne de l'agent IA) ; `full` : le texte du motif écrit (page de l'agent IA).
 */
export function NotRespondingMention({
  reason,
  accountState,
  variant,
}: {
  reason: NotRespondingReason;
  /** État affiché du compte WhatsApp du numéro : « non connecté » pour `disconnected`, « en erreur » sinon. */
  accountState: WhatsAppAccountStateView | null;
  variant: 'short' | 'full';
}) {
  const t = useTranslations('agents.notResponding');
  const hint = useHint<HTMLSpanElement>();
  const text = t(`full.${notRespondingTextKey(reason, accountState)}`);
  if (variant === 'full') return <span className="font-semibold text-danger-ink">{text}</span>;
  return (
    <>
      <span
        tabIndex={0}
        {...hint.triggerProps}
        className={`inline-flex cursor-default items-center whitespace-nowrap rounded-pill px-2.5 py-1 text-xs font-semibold ${MENTION_STYLE.pill}`}
      >
        {t('short')}
      </span>
      <HintBubble id={hint.id} open={hint.open} text={text} anchor={hint.anchorRef} />
    </>
  );
}
