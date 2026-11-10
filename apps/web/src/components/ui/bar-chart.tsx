/**
 * `emptyLabel` fourni : quand aucune valeur n'est positive (série vide ou toute à 0), les barres restent vides, rien
 * n'est mis en évidence et la mention explique pourquoi (recette Q-3).
 */
export function BarChart({ data, labels, highlightIndex, height = 80, className, emptyLabel }: { data: number[]; labels?: string[]; highlightIndex?: number; height?: number; className?: string; emptyLabel?: string }) {
  const max = Math.max(0, ...data);
  const empty = max <= 0;
  return (
    <div className={className}>
      <div className={`flex items-end gap-1.5 ${empty ? 'border-b border-border' : ''}`} style={{ height }}>
        {data.map((v, i) => (
          <div
            key={i}
            data-bar
            className={`flex-1 rounded-t-sm ${!empty && i === highlightIndex ? 'bg-accent' : 'bg-brand'}`}
            style={{ height: empty ? '0%' : `${Math.round((v / max) * 100)}%` }}
          />
        ))}
      </div>
      {empty && emptyLabel && <p className="mt-1.5 text-center text-[11.5px] text-muted-2">{emptyLabel}</p>}
      {labels && (
        <div className="mt-1.5 flex gap-1.5 text-[9px] text-muted-2">
          {labels.map((l, i) => <span key={i} className="flex-1 text-center">{l}</span>)}
        </div>
      )}
    </div>
  );
}
