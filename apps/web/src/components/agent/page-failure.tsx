'use client';
import { useTranslations } from 'next-intl';
import ErrorState from '@/app/[locale]/error';
import { Link } from '@/i18n/routing';
import { isOrgChanged } from '@/lib/api-fetch';

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
  console.error(`[${service}] chargement impossible`, err);
  return 'error';
}

/** « Agent IA introuvable. » avec lien vers la liste, ou l'état d'erreur de page existant avec « Réessayer ». */
export function PageFailureView({ kind, onRetry }: { kind: PageFailureKind; onRetry: () => void }) {
  const t = useTranslations('agents');
  if (kind === 'error') return <ErrorState error={new Error('page')} reset={onRetry} />;
  return (
    <main className="flex flex-col items-center justify-center gap-4 p-10 text-center">
      <h1 className="font-serif text-2xl text-fg">{t('notFound')}</h1>
      <Link href="/" className="text-[13px] underline">{t('notFoundBack')}</Link>
    </main>
  );
}
