'use client';
import { useTranslations } from 'next-intl';
import { LoadError } from '@/components/feedback/load-error';
import { Link } from '@/i18n/routing';
import { isOrgChanged } from '@/lib/api-fetch';
import { errorText } from '@/lib/error-text';

export type PageFailureKind = 'notFound' | 'error';

/** Réponse du BFF inutilisable : l'état de page qui correspond (404 : agent IA introuvable). */
export class PageFailure extends Error {
  constructor(readonly kind: PageFailureKind) {
    super(kind);
  }
}

/**
 * La réponse est le 409 ORG_CHANGED : `apiFetch` recharge la page, la lecture s'arrête sans rien afficher ni journaliser
 * (ni écran d'erreur, ni « introuvable », revue finale 2b-3 m-3).
 */
export class OrgChangedError extends Error {
  constructor() {
    super('ORG_CHANGED');
  }
}

export async function readOk<T>(res: Response): Promise<T> {
  if (await isOrgChanged(res)) throw new OrgChangedError();
  if (res.status === 404) throw new PageFailure('notFound');
  if (!res.ok) throw new PageFailure('error');
  return (await res.json()) as T;
}

/** Type d'échec d'une page à partir de l'erreur interceptée ; toute erreur inattendue est journalisée. */
export function failureKind(err: unknown, service: string): PageFailureKind {
  if (err instanceof PageFailure) return err.kind;
  console.error(`[${service}] chargement impossible`, errorText(err));
  return 'error';
}

/** Ce que la page n'a pas pu lire : clé de `errors.load`, pour que l'alerte le nomme (contre-audit D-5, audit §5.1). */
export type PageLoadSubject = 'connections' | 'agent' | 'agentUsage';

/**
 * « Agent IA introuvable. » avec lien vers la liste, ou, pour une lecture en échec, « Impossible de charger ... » en alerte
 * avec « Réessayer » (contre-audit D-5 : plus le titre générique « Quelque chose s'est mal passé » sans rôle d'alerte).
 */
export function PageFailureView({ kind, subject, onRetry }: { kind: PageFailureKind; subject: PageLoadSubject; onRetry: () => void }) {
  const t = useTranslations('agents');
  const tl = useTranslations('errors.load');
  if (kind === 'error') {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <LoadError message={tl(subject)} onRetry={onRetry} />
      </div>
    );
  }
  // Le titre de la page est dans son en-tête (seul `h1`) : le constat est un paragraphe, dans la zone de contenu.
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-10 text-center">
      <p className="font-serif text-2xl text-fg">{t('notFound')}</p>
      <Link href="/" className="text-[13px] underline">{t('notFoundBack')}</Link>
    </div>
  );
}
