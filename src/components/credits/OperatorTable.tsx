"use client";

import clsx from "clsx";
import { firstNameKey, type OperatorSummary, type SortDir, type SortKey } from "@/lib/creditsDashboard";

export interface EditorPerformanceLookup {
  mainAdsCount: number;
  totalDurationSeconds: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const SORT_BUTTONS: Array<{ key: SortKey; label: string }> = [
  { key: "totalCredits", label: "Total Credits" },
  { key: "clips", label: "No. of Clips" },
  { key: "creditsPerClip", label: "Credits/Clip" },
];

const LOAD_STYLES: Record<OperatorSummary["load"], string> = {
  Heavy: "bg-red-500/15 text-red-400",
  Medium: "bg-credits-orange/15 text-credits-orange",
  Light: "bg-credits-green/15 text-credits-green",
};

function SortableHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={clsx(
        "cursor-pointer px-4 py-3 font-medium select-none",
        active ? "text-credits-purple" : "text-credits-muted"
      )}
    >
      {label}
      {active ? (dir === "desc" ? " ↓" : " ↑") : ""}
    </th>
  );
}

export function OperatorTable({
  operators,
  sortKey,
  sortDir,
  onSort,
  maxTotalCredits,
  performanceByEditor,
}: {
  operators: OperatorSummary[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  maxTotalCredits: number;
  // Cross-referenced against the Performance tab, matched by lowercased operator/editor name —
  // absent (or all-zero) when the CSV's operator name doesn't match any known editor.
  performanceByEditor: Map<string, EditorPerformanceLookup>;
}) {
  return (
    <div className="rounded-xl border border-credits-border bg-credits-card">
      <div className="flex flex-wrap gap-2 border-b border-credits-border p-4">
        {SORT_BUTTONS.map((btn) => (
          <button
            key={btn.key}
            onClick={() => onSort(btn.key)}
            className={clsx(
              "rounded-md px-3 py-1.5 text-sm font-medium transition",
              sortKey === btn.key ? "bg-credits-accent text-white" : "bg-credits-bg text-credits-muted hover:text-credits-text"
            )}
          >
            Sort by {btn.label} {sortKey === btn.key ? (sortDir === "desc" ? "↓" : "↑") : ""}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-credits-border">
              <th className="px-4 py-3 font-medium text-credits-muted">#</th>
              <th className="px-4 py-3 font-medium text-credits-muted">Operator</th>
              <SortableHeader label="No. of Clips" sortKey="clips" active={sortKey === "clips"} dir={sortDir} onSort={onSort} />
              <SortableHeader
                label="Total Credits"
                sortKey="totalCredits"
                active={sortKey === "totalCredits"}
                dir={sortDir}
                onSort={onSort}
              />
              <th className="px-4 py-3 font-medium text-credits-muted">% Consumption</th>
              <SortableHeader
                label="Credits/Clip"
                sortKey="creditsPerClip"
                active={sortKey === "creditsPerClip"}
                dir={sortDir}
                onSort={onSort}
              />
              <th className="px-4 py-3 font-medium text-credits-muted">Load</th>
              <th className="px-4 py-3 font-medium text-credits-muted">Credits/Main Ad</th>
              <th className="px-4 py-3 font-medium text-credits-muted">Credits/Duration (s)</th>
            </tr>
          </thead>
          <tbody>
            {operators.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-credits-dim">
                  No data for the selected filters.
                </td>
              </tr>
            )}
            {operators.map((op, index) => {
              const perf = performanceByEditor.get(firstNameKey(op.operator));
              const creditsPerMainAd = perf && perf.mainAdsCount > 0 ? round1(op.totalCredits / perf.mainAdsCount) : null;
              const creditsPerDuration =
                perf && perf.totalDurationSeconds > 0 ? round1(op.totalCredits / perf.totalDurationSeconds) : null;

              return (
                <tr key={op.operator} className="border-b border-credits-border/60">
                  <td className="px-4 py-3 text-credits-dim">{index + 1}</td>
                  <td className="px-4 py-3 font-medium text-credits-text">{op.operator}</td>
                  <td className="px-4 py-3 text-credits-text">{op.clips}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-credits-text">{op.totalCredits.toLocaleString()}</span>
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-credits-bg">
                        <div
                          className="h-full rounded-full bg-credits-accent"
                          style={{ width: `${maxTotalCredits > 0 ? (op.totalCredits / maxTotalCredits) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-credits-text">{op.pctConsumption}%</td>
                  <td className="px-4 py-3 text-credits-text">{op.creditsPerClip}</td>
                  <td className="px-4 py-3">
                    <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", LOAD_STYLES[op.load])}>
                      {op.load}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-credits-text">{creditsPerMainAd ?? "—"}</td>
                  <td className="px-4 py-3 text-credits-text">{creditsPerDuration ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
