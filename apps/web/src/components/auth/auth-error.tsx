'use client';

import { useTranslations } from 'next-intl';

/** Refus d'un formulaire d'authentification : texte de l'écran et, pour une panne serveur, référence de la requête. */
export interface AuthFailure {
  message: string;
  reference: string | null;
}

/** Ligne d'erreur des formulaires publics (même rendu que la connexion) ; la référence suit le message (audit R-14). */
export function AuthError({ error }: { error: AuthFailure }) {
  const t = useTranslations('errors.generic');
  return (
    <div role="alert" className="mt-3 text-[13px] text-danger">
      <p>{error.message}</p>
      {error.reference && <p className="mt-0.5 text-[11.5px]">{t('reference', { reference: error.reference })}</p>}
    </div>
  );
}
