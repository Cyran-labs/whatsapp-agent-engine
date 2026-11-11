import { useFormatter, useTranslations } from 'next-intl';
import { UserRound } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadError, type RetryState } from '@/components/feedback/load-error';
import { FAILED, type Failed } from './panel-ui';
import { parseEngineDate } from '@/lib/engine-date';

export interface RecentRow {
  phone: string;
  name: string | null;
  last: string;
  qualified: boolean;
  /** Date du dernier message telle que le moteur la renvoie (UTC, éventuellement sans fuseau). */
  when: string;
}

/**
 * Initiales d'un contact : première lettre des deux premiers mots de son nom (« Marie Curie » donne « MC »). Sans nom,
 * rien : la ligne porte une icône de contact, jamais des chiffres tirés du numéro, entier ou masqué par le moteur
 * (spec 9.2 et 10.3).
 */
export function contactInitials(name: string | null): string {
  if (name === null) return '';
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase();
}

/**
 * `rows` nul : chargement en cours, trois lignes squelettes. `FAILED` : « Conversations indisponibles » avec
 * « Réessayer », jamais « Aucune conversation » (audit R-17).
 */
export function RecentConversations({ rows, onRetry, retry }: { rows: RecentRow[] | null | Failed; onRetry: () => void; retry?: RetryState }) {
  const t = useTranslations('overview');
  const format = useFormatter();
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      {/* « voir tout » retiré tant que la page Conversations et leads n'existe pas (spec 10.3) */}
      <h3 className="mb-3.5 font-serif text-base font-normal">{t('recentTitle')}</h3>
      {rows === FAILED ? (
        <LoadError message={t('recentUnavailable')} onRetry={onRetry} retry={retry} />
      ) : rows === null ? (
        [0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5 border-b border-border py-2.5 last:border-b-0">
            <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-3 w-10" />
          </div>
        ))
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-muted-2">{t('noRecent')}</p>
      ) : (
        rows.map((r, i) => {
          // Heure de Paris, comme les autres dates ; une date absente ou illisible n'affiche rien.
          const when = parseEngineDate(r.when);
          const initials = contactInitials(r.name);
          // Clé par position : deux numéros masqués par le moteur peuvent être égaux, aucun champ n'est unique.
          return (
            <div key={i} className="flex items-center gap-2.5 border-b border-border py-2.5 text-[13px] last:border-b-0">
              <span data-avatar="" aria-hidden="true" className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-surface-subtle text-[10px] font-bold text-brand">
                {initials !== '' ? initials : <UserRound className="h-3.5 w-3.5" strokeWidth={2} />}
              </span>
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-muted">{r.last}</span>
              {r.qualified && (
                <span className="rounded-pill bg-success-soft px-2 py-px text-[10px] font-semibold text-success-ink">
                  {t('infoCollected')}
                </span>
              )}
              {when && (
                <span className="whitespace-nowrap text-[11px] text-muted-2">{format.dateTime(when, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
