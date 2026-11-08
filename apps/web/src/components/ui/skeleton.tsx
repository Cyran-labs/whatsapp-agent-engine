import { cn } from '@/lib/utils';

/**
 * Bloc de chargement : forme du contenu attendu, pulsation d'opacité (aucune avec mouvement réduit),
 * jamais de shimmer en dégradé. Le cadre de la page (bandeau, rail) reste affiché autour.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-skeleton=""
      className={cn('block rounded-md border border-border bg-surface-subtle motion-safe:animate-pulse', className)}
    />
  );
}

/** Forme d'une cellule de tableau en chargement. */
export type SkeletonCell = 'title' | 'line' | 'pill' | 'avatar' | 'number' | 'none';

function Cell({ kind }: { kind: SkeletonCell }) {
  switch (kind) {
    case 'title':
      return (
        <>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-1.5 h-3 w-20" />
        </>
      );
    case 'line':
      return <Skeleton className="h-3.5 w-24" />;
    case 'pill':
      return <Skeleton className="h-[22px] w-16 rounded-full" />;
    case 'avatar':
      return (
        <span className="flex items-center gap-2.5">
          <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
          <Skeleton className="h-3.5 w-40" />
        </span>
      );
    case 'number':
      return <Skeleton className="ml-auto h-3.5 w-10" />;
    case 'none':
      return null;
  }
}

/** Lignes squelettes d'un tableau (en-tête réel conservé par l'appelant) : une cellule par colonne. */
export function SkeletonRows({ cells, rows = 3, cellClassName }: { cells: SkeletonCell[]; rows?: number; cellClassName?: string }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} aria-hidden="true" data-skeleton-row="" className="border-t border-border first:border-t-0">
          {cells.map((kind, index) => (
            <td key={index} className={cellClassName}>
              <Cell kind={kind} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
