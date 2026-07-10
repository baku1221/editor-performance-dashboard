import type { CreditRow } from "@/lib/creditsDashboard";

export function ActivityFeed({ rows }: { rows: CreditRow[] }) {
  return (
    <div className="rounded-xl border border-credits-border bg-credits-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-credits-text">Recent Activity</h3>
      <div className="max-h-[320px] space-y-1 overflow-y-auto">
        {rows.length === 0 && <p className="text-sm text-credits-dim">No transactions for the selected filters.</p>}
        {rows.map((row, index) => (
          <div
            key={`${row.operator}-${row.operatingTime}-${index}`}
            className="flex items-center justify-between border-b border-credits-border/40 py-2 text-sm last:border-b-0"
          >
            <div>
              <span className="text-credits-text">{row.operatingTime}</span>
              <span className="ml-2 text-credits-muted">
                {row.operator} · {row.date}
              </span>
            </div>
            <span className="font-medium text-credits-green">{row.credits}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
