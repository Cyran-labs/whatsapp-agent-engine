// Éléments communs des encarts de la page de l'agent IA (numéro, statut, accès limité).
import { Skeleton } from '@/components/ui/skeleton';

const CARD = 'rounded-xl border border-border bg-surface p-[18px] shadow-sm';

export function Card({ title, children, labelledBy }: { title: string; children: React.ReactNode; labelledBy: string }) {
  return (
    <section aria-labelledby={labelledBy} className={`mt-4 ${CARD}`}>
      <h3 id={labelledBy} className="mb-3 font-serif text-base font-normal">{title}</h3>
      {children}
    </section>
  );
}

export const ACTION =
  'rounded-md border border-border-strong bg-surface px-3 py-[7px] text-[13px] font-semibold text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50';

/** Encart en chargement : son titre réel et des lignes en squelette. */
export function PanelSkeleton({ title }: { title: string }) {
  return (
    <section className={`mt-4 ${CARD}`}>
      <h3 className="mb-3 font-serif text-base font-normal">{title}</h3>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-56" />
    </section>
  );
}
