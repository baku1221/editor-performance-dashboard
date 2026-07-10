export function SummaryCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-app-border bg-app-card p-4 shadow-sm">
      <div className="text-sm text-app-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-app-text">{value}</div>
      {sub && <div className="mt-1 text-xs text-app-dim">{sub}</div>}
    </div>
  );
}
