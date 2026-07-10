"use client";

import { useState } from "react";
import useSWR from "swr";
import clsx from "clsx";
import { jsonFetcher } from "@/lib/swrFetcher";
import { buildQueryString, type UiFilters } from "@/lib/clientFilters";
import type { ProgressItem } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

type DailyView = "inProgress" | "completed";

// Preferred display order for the known cohorts; anything else falls back to alphabetical.
const COHORT_ORDER = ["Astrotalk Foreign", "Lumus"];

// Same purple/yellow system as the Performance tab's business-unit theme, for visual consistency.
const COHORT_THEME: Record<string, { header: string; titleText: string; badge: string }> = {
  Lumus: { header: "bg-purple-950/50 border-purple-800/50", titleText: "text-purple-300", badge: "bg-purple-500/20 text-purple-300" },
  "Astrotalk Foreign": {
    header: "bg-yellow-950/50 border-yellow-800/50",
    titleText: "text-yellow-300",
    badge: "bg-yellow-500/20 text-yellow-300",
  },
};

function themeForCohort(cohort: string) {
  return COHORT_THEME[cohort] ?? { header: "bg-app-bg border-app-border", titleText: "text-app-text", badge: "bg-app-border text-app-muted" };
}

function sortCohorts(cohorts: string[]): string[] {
  return [...cohorts].sort((a, b) => {
    const ai = COHORT_ORDER.indexOf(a);
    const bi = COHORT_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The day the Completed view scopes to. The global date filter's "To" (or "From", if only that's
 * set) picks a specific past day — e.g. selecting 2026-07-05 shows what was completed that day,
 * not today's completions. With no date filter active, defaults to today.
 */
function referenceDate(filters: UiFilters): string {
  return filters.to || filters.from || todayIso();
}

// "In Progress" is a current state (Working/Review/Delayed all mean someone's actively on it
// right now) — never date-scoped, which is also why it has no date column. "Completed" is
// scoped to referenceDate, per the completedDate column.
function matchesView(item: ProgressItem, view: DailyView, refDate: string): boolean {
  if (view === "completed") return item.status === "Completed" && item.completedDate === refDate;
  return item.status === "Working" || item.status === "Review" || item.status === "Delayed";
}

function CohortBadge({ cohort }: { cohort: string }) {
  const theme = themeForCohort(cohort);
  return <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", theme.badge)}>{cohort}</span>;
}

function ProgressTable({ rows, view, refDate }: { rows: ProgressItem[]; view: DailyView; refDate: string }) {
  const showCompletedDateColumn = view === "completed";

  return (
    <div className="overflow-x-auto rounded-xl border border-app-border bg-app-card shadow-sm">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-app-border text-app-muted">
            <th className="px-4 py-3 font-medium">Cohort</th>
            <th className="px-4 py-3 font-medium">Editor</th>
            <th className="px-4 py-3 font-medium">Current Video</th>
            <th className="px-4 py-3 font-medium">Current Stage</th>
            <th className="px-4 py-3 font-medium">Status</th>
            {showCompletedDateColumn && (
              <>
                <th className="px-4 py-3 font-medium">Completed Date</th>
                <th className="px-4 py-3 font-medium">Duration (s)</th>
                <th className="px-4 py-3 font-medium">Winning</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={showCompletedDateColumn ? 8 : 5} className="px-4 py-6 text-center text-app-dim">
                {view === "completed" ? `Nothing completed on ${refDate}.` : "Nothing in progress."}
              </td>
            </tr>
          )}
          {rows.map((item) => (
            <tr key={item.id} className="border-b border-app-border/60 hover:bg-white/5">
              <td className="px-4 py-3">
                <CohortBadge cohort={item.cohort} />
              </td>
              <td className="px-4 py-3 font-medium text-app-text">{item.editorName}</td>
              <td className="px-4 py-3 text-app-muted">{item.videoName}</td>
              <td className="px-4 py-3 text-app-muted">{item.currentStage}</td>
              <td className="px-4 py-3">
                <StatusBadge status={item.status} />
              </td>
              {showCompletedDateColumn && (
                <>
                  <td className="px-4 py-3 text-app-muted">{item.completedDate || "—"}</td>
                  <td className="px-4 py-3 text-app-muted">{item.matchedDurationSeconds ?? "—"}</td>
                  <td className="px-4 py-3">
                    {item.matchedIsWinning === null ? (
                      <span className="text-app-dim">—</span>
                    ) : item.matchedIsWinning ? (
                      <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-300">
                        Winning
                      </span>
                    ) : (
                      <span className="text-app-dim">No</span>
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProgressTab({ filters }: { filters: UiFilters }) {
  const query = buildQueryString(filters);
  const { data, isLoading } = useSWR<ProgressItem[]>(`/api/progress?${query}`, jsonFetcher);
  const [view, setView] = useState<DailyView>("inProgress");

  const refDate = referenceDate(filters);
  const isToday = refDate === todayIso();
  const cohortRank = new Map(sortCohorts(Array.from(new Set(data?.map((item) => item.cohort) ?? []))).map((c, i) => [c, i]));
  const visibleRows = data
    ?.filter((item) => matchesView(item, view, refDate))
    .sort((a, b) => (cohortRank.get(a.cohort) ?? 0) - (cohortRank.get(b.cohort) ?? 0) || a.editorName.localeCompare(b.editorName));

  const views: Array<{ key: DailyView; label: string }> = [
    { key: "inProgress", label: "In Progress" },
    { key: "completed", label: isToday ? "Completed Today" : `Completed on ${refDate}` },
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg border border-app-border bg-app-card p-1 shadow-sm w-fit">
        {views.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={clsx(
              "rounded-md px-3 py-1.5 text-sm font-medium transition",
              view === v.key ? "bg-purple-600 text-white" : "text-app-muted hover:bg-white/5 hover:text-app-text"
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="rounded-xl border border-app-border bg-app-card p-6 text-center text-app-dim shadow-sm">Loading…</div>
      )}

      {!isLoading && <ProgressTable rows={visibleRows ?? []} view={view} refDate={refDate} />}
    </div>
  );
}
