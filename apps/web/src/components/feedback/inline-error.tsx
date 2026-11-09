'use client';

import { useTranslations } from 'next-intl';

interface Props {
  message: string;
  /** Référence de la requête (panne serveur, `describeFailure(...).reference`), à citer au support. */
  reference?: string | null;
  /** Action qui répond au refus (lien, bouton), affichée à droite du message. */
  action?: React.ReactNode;
}

/**
 * Refus d'une action dans une fenêtre, un tiroir, une ligne ou un panneau (audit §5.1) : à l'endroit de l'action,
 * jamais en notification. La référence de la requête suit le message, en petit (audit R-14).
 */
export function InlineError({ message, reference, action }: Props) {
  const t = useTranslations('errors.generic');
  return (
    <div role="alert" className="flex items-center gap-3 rounded-lg bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger-ink">
      <div className="min-w-0">
        <p>{message}</p>
        {reference && <p className="mt-0.5 text-[11.5px]">{t('reference', { reference })}</p>}
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}
