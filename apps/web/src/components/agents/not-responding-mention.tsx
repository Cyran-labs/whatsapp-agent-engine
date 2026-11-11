'use client';
import { useTranslations } from 'next-intl';
import type { NotRespondingReason, WhatsAppAccountStateView } from '@wabagent/contracts';
import { HintBubble, useHint } from '@/components/shell/coming-soon';
import { mentionTone, notRespondingTextKey } from '@/lib/status-words';
import { DANGER_MARK, NEUTRAL_MARK } from './status-style';

/**
 * Mention « Ne répond pas » (spec 7), lue du champ `not_responding` du moteur, jamais recalculée ici. `mark` : marque
 * sans texte rouge, bouton sans autre effet dont la bulle (survol, focus, clic) sert de description accessible (liste,
 * Connexions, colonne et titre de l'agent IA) ; selon `mentionTone`, point rouge à poser sur la pastille de statut
 * (`StatusPill`, `mark`), nommé « Ne répond pas », bulle du motif (recette 3.4), ou, pour la Whitelist vide, étiquette
 * neutre « Whitelist vide » à côté de la pastille, bulle de l'invitation (recette 3.5). `full` : le texte du motif écrit.
 */
export function NotRespondingMention({
  reason,
  accountState,
  variant,
}: {
  reason: NotRespondingReason;
  /** État affiché du compte WhatsApp du numéro : « non connecté » pour `disconnected`, « en erreur » sinon. */
  accountState: WhatsAppAccountStateView | null;
  variant: 'mark' | 'full';
}) {
  const t = useTranslations('agents.notResponding');
  const hint = useHint<HTMLButtonElement>();
  const text = t(`full.${notRespondingTextKey(reason, accountState)}`);
  if (variant === 'full') return <span className="font-semibold text-danger-ink">{text}</span>;
  // relecture tâche 7, M-4 : bouton sans autre effet que la bulle, pour un rôle annoncé et une description lue
  if (mentionTone(reason) === 'neutral') {
    return (
      <>
        <button
          type="button"
          data-mention="neutral"
          {...hint.triggerProps}
          className={`inline-flex cursor-default items-center whitespace-nowrap rounded-pill px-2.5 py-1 text-xs font-semibold ${NEUTRAL_MARK}`}
        >
          {t('emptyAllowlist.label')}
        </button>
        <HintBubble id={hint.id} open={hint.open} text={t('emptyAllowlist.hint')} anchor={hint.anchorRef} />
      </>
    );
  }
  return (
    <>
      {/* Zone de 16 px centrée sur le coin de la pastille, pour viser le point de 8 px à la souris */}
      <button
        type="button"
        data-mention="danger"
        aria-label={t('short')}
        {...hint.triggerProps}
        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 cursor-default items-center justify-center rounded-full"
      >
        <span className={DANGER_MARK} aria-hidden="true" />
      </button>
      <HintBubble id={hint.id} open={hint.open} text={text} anchor={hint.anchorRef} />
    </>
  );
}
