'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/feedback/inline-error';
import type { DescribedFailure } from '@/lib/describe-failure';

/** Refus d'une action de ligne, avec le nom de la ligne (audit R-27) : le nom suffit si la ligne a disparu à la relecture. */
export interface RowFailure {
  name: string;
  failure: DescribedFailure;
}

export type RowFailures = ReadonlyMap<number, RowFailure>;

/** Ligne de tableau sous la ligne concernée : le refus nomme la ligne, « Fermer » le retire. */
export function RowErrorRow({ colSpan, rowFailure, onDismiss }: { colSpan: number; rowFailure: RowFailure; onDismiss: () => void }) {
  const t = useTranslations('organisation');
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 pb-3 pt-0">
        <InlineError
          message={t('rowError', { name: rowFailure.name, message: rowFailure.failure.message })}
          reference={rowFailure.failure.reference}
          action={
            <Button type="button" variant="outline" onClick={onDismiss} className="h-auto border-border-strong px-2.5 py-[5px] text-[12.5px] font-normal">
              {t('dismiss')}
            </Button>
          }
        />
      </td>
    </tr>
  );
}

/** Refus dont la ligne n'est plus dans la liste relue (invitation acceptée ailleurs) : affichés en fin de tableau. */
export function OrphanRowErrors({ colSpan, failures, presentIds, onDismiss }: {
  colSpan: number;
  failures: RowFailures;
  presentIds: ReadonlySet<number>;
  onDismiss: (id: number) => void;
}) {
  return (
    <>
      {[...failures].filter(([id]) => !presentIds.has(id)).map(([id, rowFailure]) => (
        <RowErrorRow key={`orphan-${id}`} colSpan={colSpan} rowFailure={rowFailure} onDismiss={() => onDismiss(id)} />
      ))}
    </>
  );
}
