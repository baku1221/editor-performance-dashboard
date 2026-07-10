import type { DailySummary } from "@/lib/creditsDashboard";

export function DailyBreakdown({ daily }: { daily: DailySummary[] }) {
  return (
    <div className="rounded-xl border border-credits-border bg-credits-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-credits-text">Daily Breakdown</h3>
      <div className="max-h-[420px] space-y-2 overflow-y-auto">
        {daily.length === 0 && <p className="text-sm text-credits-dim">No data for the selected filters.</p>}
        {daily.map((day) => (
          <div key={day.date} className="flex items-center justify-between rounded-lg border border-credits-border/60 p-3">
            <div>
              <div className="text-sm font-medium text-credits-text">{day.date}</div>
              <div className="text-xs text-credits-muted">
                {day.clips} clips · {day.avgCreditsPerClip} avg credits/clip
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold text-credits-cyan">{day.totalCredits.toLocaleString()}</div>
              <div className="text-xs text-credits-muted">{day.pctOfGrandTotal}% of total</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
