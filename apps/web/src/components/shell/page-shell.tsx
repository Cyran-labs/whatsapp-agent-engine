export function PageShell({ rail, children }: { rail: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 overflow-hidden">
      {rail}
      <div className="flex-1 overflow-auto px-8 py-7">{children}</div>
    </div>
  );
}
