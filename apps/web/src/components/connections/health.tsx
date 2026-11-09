/** Pastille d'état des connexions : point coloré puis texte (maquette « health »). */
export type HealthTone = 'success' | 'warning' | 'danger' | 'neutral';

const DOT: Record<HealthTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-muted-2',
};

export function Health({ tone, children, className = '' }: { tone: HealthTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[7px] text-[12.5px] font-semibold ${className}`}>
      <span aria-hidden="true" className={`h-[9px] w-[9px] shrink-0 rounded-full ${DOT[tone]}`} />
      {children}
    </span>
  );
}
