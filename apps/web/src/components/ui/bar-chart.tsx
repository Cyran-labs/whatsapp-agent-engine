export function BarChart({ data, labels, highlightIndex, height = 80, className }: { data: number[]; labels?: string[]; highlightIndex?: number; height?: number; className?: string }) {
  const max = Math.max(0, ...data);
  return (
    <div className={className}>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((v, i) => (
          <div
            key={i}
            data-bar
            className={`flex-1 rounded-t-sm ${i === highlightIndex ? 'bg-accent' : 'bg-brand'}`}
            style={{ height: max > 0 ? `${Math.round((v / max) * 100)}%` : '0%' }}
          />
        ))}
      </div>
      {labels && (
        <div className="mt-1.5 flex gap-1.5 text-[9px] text-muted-2">
          {labels.map((l, i) => <span key={i} className="flex-1 text-center">{l}</span>)}
        </div>
      )}
    </div>
  );
}
