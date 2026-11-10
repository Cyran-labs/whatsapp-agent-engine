const BAR_MAX_WIDTH = 56;
const GAP = 6;
/** Jusqu'à ce nombre de barres, chaque barre porte sa date ; au-delà, seules la première et la dernière. */
const LABEL_EVERY_BAR_UP_TO = 7;

/**
 * `emptyLabel` fourni : quand aucune valeur n'est positive (série vide ou toute à 0), les barres restent vides, rien
 * n'est mis en évidence et la mention explique pourquoi (recette Q-3).
 * Barres de largeur bornée (une seule barre ne remplit pas toute la largeur) ; `labels` (une date par valeur) s'écrit
 * sous chaque barre jusqu'à 7 barres, sous la première et la dernière au-delà (recette du 10 nov. 2026).
 */
export function BarChart({ data, labels, highlightIndex, height = 80, className, emptyLabel }: { data: number[]; labels?: string[]; highlightIndex?: number; height?: number; className?: string; emptyLabel?: string }) {
  const max = Math.max(0, ...data);
  const empty = max <= 0;
  const everyBar = data.length <= LABEL_EVERY_BAR_UP_TO;
  const ends = labels && labels.length > 1 ? [labels[0], labels[labels.length - 1]] : labels;
  return (
    <div className={className}>
      <div className={`flex items-end justify-center gap-1.5 ${empty ? 'border-b border-border' : ''}`} style={{ height }}>
        {data.map((v, i) => (
          <div key={i} className="flex h-full max-w-[56px] flex-1 items-end">
            <div
              data-bar
              className={`w-full rounded-t-sm ${!empty && i === highlightIndex ? 'bg-accent' : 'bg-brand'}`}
              style={{ height: empty ? '0%' : `${Math.round((v / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      {empty && emptyLabel && <p className="mt-1.5 text-center text-[11.5px] text-muted-2">{emptyLabel}</p>}
      {labels && labels.length > 0 && (everyBar ? (
        <div className="mt-1.5 flex justify-center gap-1.5 text-[10px] text-muted-2">
          {labels.map((l, i) => <span key={i} className="max-w-[56px] flex-1 whitespace-nowrap text-center">{l}</span>)}
        </div>
      ) : (
        <div className="mx-auto mt-1.5 flex justify-between text-[10px] text-muted-2" style={{ maxWidth: data.length * BAR_MAX_WIDTH + (data.length - 1) * GAP }}>
          {ends?.map((l, i) => <span key={i} className="whitespace-nowrap">{l}</span>)}
        </div>
      ))}
    </div>
  );
}
