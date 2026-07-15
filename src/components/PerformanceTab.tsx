"use client";

import { useState } from "react";
import useSWR from "swr";
import clsx from "clsx";
import { jsonFetcher } from "@/lib/swrFetcher";
import { buildQueryString, type UiFilters } from "@/lib/clientFilters";
import type { EditorPerformanceRow, PerformanceData, PerformanceSummary } from "@/lib/types";
import { computeMveScores } from "@/lib/services/mveScoreService";
import { SummaryCard } from "./SummaryCard";
import { EditorDetailPanel } from "./EditorDetailPanel";

const ALL_UNIT = "All";

// Preferred display order for the known business units; anything else falls back to alphabetical.
const BUSINESS_UNIT_ORDER = ["Lumus", "Astrotalk", "Astrotalk Store", "Social Media"];

function sortBusinessUnits(units: string[]): string[] {
  return [...units].sort((a, b) => {
    const ai = BUSINESS_UNIT_ORDER.indexOf(a);
    const bi = BUSINESS_UNIT_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

// Neutral for the combined view, purple for Lumus, yellow for Astrotalk — consistent across the
// tab pill, the summary/table panel wash, and the table header.
const UNIT_THEME: Record<string, { tab: string; panel: string; header: string; accentText: string; rowHover: string }> = {
  [ALL_UNIT]: {
    tab: "bg-white/10 text-app-text border border-app-border",
    panel: "border-app-border bg-app-card",
    header: "bg-app-bg border-app-border text-app-muted",
    accentText: "text-app-muted",
    rowHover: "hover:bg-white/5",
  },
  Lumus: {
    tab: "bg-purple-600 text-white",
    panel: "border-purple-800/50 bg-purple-950/20",
    header: "bg-purple-950/50 border-purple-800/50 text-purple-300",
    accentText: "text-purple-300",
    rowHover: "hover:bg-purple-500/10",
  },
  Astrotalk: {
    tab: "bg-yellow-400 text-gray-900",
    panel: "border-yellow-800/50 bg-yellow-950/20",
    header: "bg-yellow-950/50 border-yellow-800/50 text-yellow-300",
    accentText: "text-yellow-300",
    rowHover: "hover:bg-yellow-500/10",
  },
  "Astrotalk Store": {
    tab: "bg-teal-400 text-gray-900",
    panel: "border-teal-800/50 bg-teal-950/20",
    header: "bg-teal-950/50 border-teal-800/50 text-teal-300",
    accentText: "text-teal-300",
    rowHover: "hover:bg-teal-500/10",
  },
  "Social Media": {
    tab: "bg-pink-400 text-gray-900",
    panel: "border-pink-800/50 bg-pink-950/20",
    header: "bg-pink-950/50 border-pink-800/50 text-pink-300",
    accentText: "text-pink-300",
    rowHover: "hover:bg-pink-500/10",
  },
};

function themeFor(unit: string) {
  return UNIT_THEME[unit] ?? (UNIT_THEME[ALL_UNIT] as (typeof UNIT_THEME)[typeof ALL_UNIT]);
}

type ScoredRow = EditorPerformanceRow & { mveScore: number | null };

type SortKey =
  | "videosSubmitted"
  | "mainAdsCount"
  | "winningCreatives"
  | "winningPercent"
  | "activeCreatives"
  | "totalDurationSeconds"
  | "mveScore";
type SortDir = "asc" | "desc";

// mveScore is null for "Unmapped" — treated as lowest-possible so it sorts to the bottom
// regardless of direction, rather than colliding with real 0-scored editors.
function sortRows(rows: ScoredRow[], sortKey: SortKey | null, sortDir: SortDir): ScoredRow[] {
  if (!sortKey) return rows;
  const sorted = [...rows].sort((a, b) => (a[sortKey] ?? -1) - (b[sortKey] ?? -1));
  return sortDir === "desc" ? sorted.reverse() : sorted;
}

function SortableHeader({
  label,
  sortKey,
  active,
  dir,
  accentText,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  accentText: string;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={clsx("cursor-pointer select-none px-4 py-3 font-medium", active && accentText)}
    >
      {label}
      {active ? (dir === "desc" ? " ↓" : " ↑") : ""}
    </th>
  );
}

/** Computed purely from row-level fields — used for every view (a single unit, "All" combined, or editor-filtered). */
function deriveSummaryFromRows(rows: EditorPerformanceRow[], dateRange: PerformanceSummary["dateRange"]): PerformanceSummary {
  const totalVideosSubmitted = rows.reduce((sum, r) => sum + r.videosSubmitted, 0);
  const totalMainAds = rows.reduce((sum, r) => sum + r.mainAdsCount, 0);
  const winningCreatives = rows.reduce((sum, r) => sum + r.winningCreatives, 0);

  return {
    totalVideosSubmitted,
    totalMainAds,
    winningCreatives,
    winningPercent: totalVideosSubmitted > 0 ? Math.round((winningCreatives / totalVideosSubmitted) * 1000) / 10 : 0,
    totalEditors: rows.filter((r) => r.editorName !== "Unmapped").length,
    dateRange,
  };
}

/** Merges each editor's rows across both business units into one combined row, for the "All" tab. */
function combineRowsByEditor(rows: EditorPerformanceRow[]): EditorPerformanceRow[] {
  const byEditor = new Map<string, EditorPerformanceRow>();

  for (const row of rows) {
    const existing = byEditor.get(row.editorName);
    if (!existing) {
      byEditor.set(row.editorName, { ...row, businessUnit: ALL_UNIT });
      continue;
    }
    existing.videosSubmitted += row.videosSubmitted;
    existing.mainAdsCount += row.mainAdsCount;
    existing.winningCreatives += row.winningCreatives;
    existing.activeCreatives += row.activeCreatives;
    existing.totalDurationSeconds += row.totalDurationSeconds;
  }

  return Array.from(byEditor.values())
    .map((row) => ({
      ...row,
      winningPercent: row.videosSubmitted > 0 ? Math.round((row.winningCreatives / row.videosSubmitted) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.editorName.localeCompare(b.editorName));
}

export function PerformanceTab({ filters }: { filters: UiFilters }) {
  const query = buildQueryString(filters);
  const { data, isLoading } = useSWR<PerformanceData>(`/api/performance?${query}`, jsonFetcher);
  const [selectedEditor, setSelectedEditor] = useState<string | null>(null);
  const [businessUnit, setBusinessUnit] = useState<string>(ALL_UNIT);
  const [editorFilter, setEditorFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>("mainAdsCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const availableUnits = sortBusinessUnits(data?.businessUnits.map((b) => b.businessUnit) ?? []);
  const tabs = [ALL_UNIT, ...availableUnits];
  const activeUnit = tabs.includes(businessUnit) ? businessUnit : ALL_UNIT;
  const theme = themeFor(activeUnit);

  const unitRows =
    activeUnit === ALL_UNIT
      ? combineRowsByEditor(data?.rows ?? [])
      : data?.rows.filter((r) => r.businessUnit === activeUnit) ?? [];

  // Normalized against whichever cohort is currently active — switching business-unit tabs
  // naturally recomputes each editor's MVE Score relative to just their peers in that unit (or
  // everyone, on the "All" tab), since unitRows is already scoped that way above.
  const scoredRows = computeMveScores(unitRows);

  const editorOptions = Array.from(new Set(scoredRows.map((r) => r.editorName))).sort((a, b) => a.localeCompare(b));
  const filteredRows = editorFilter ? scoredRows.filter((r) => r.editorName === editorFilter) : scoredRows;
  const rows = sortRows(filteredRows, sortKey, sortDir);
  const dateRange = data?.businessUnits[0]?.summary.dateRange ?? null; // same configured window for every unit
  const summary = deriveSummaryFromRows(rows, dateRange);

  function handleSelectUnit(unit: string) {
    setBusinessUnit(unit);
    setEditorFilter("");
  }

  return (
    <div className="space-y-4">
      {data && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg border border-app-border bg-app-card p-1 shadow-sm w-fit">
            {tabs.map((unit) => (
              <button
                key={unit}
                onClick={() => handleSelectUnit(unit)}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  unit === activeUnit ? theme.tab : "text-app-muted hover:bg-white/5 hover:text-app-text"
                )}
              >
                {unit}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-app-muted">Editor</label>
            <select
              className="rounded-lg border border-app-border bg-app-bg px-2.5 py-1.5 text-sm text-app-text focus:border-purple-400 focus:outline-none"
              value={editorFilter}
              onChange={(e) => setEditorFilter(e.target.value)}
            >
              <option value="">All</option>
              {editorOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className={clsx("space-y-4 rounded-xl border p-4", theme.panel)}>
        {summary.dateRange && (
          <p className={clsx("text-sm", theme.accentText)}>
            Analyzing ads from {summary.dateRange.from} to {summary.dateRange.to} (today)
          </p>
        )}

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <SummaryCard label="Total Ads (with Cuts)" value={summary.totalVideosSubmitted} />
          <SummaryCard label="Total Unique Ads (Main)" value={summary.totalMainAds} />
          <SummaryCard label="Winning Creatives" value={summary.winningCreatives} />
          <SummaryCard label="Winning %" value={`${summary.winningPercent}%`} />
          <SummaryCard label="Total Editors" value={summary.totalEditors} />
        </div>

        <div className="overflow-x-auto rounded-xl border border-app-border bg-app-card shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className={clsx("border-b", theme.header)}>
                <th className="px-4 py-3 font-medium">Editor Name</th>
                <SortableHeader
                  label="Videos Submitted"
                  sortKey="videosSubmitted"
                  active={sortKey === "videosSubmitted"}
                  dir={sortDir}
                  accentText={theme.accentText}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Main Ads"
                  sortKey="mainAdsCount"
                  active={sortKey === "mainAdsCount"}
                  dir={sortDir}
                  accentText={theme.accentText}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Winning Creatives"
                  sortKey="winningCreatives"
                  active={sortKey === "winningCreatives"}
                  dir={sortDir}
                  accentText={theme.accentText}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Winning %"
                  sortKey="winningPercent"
                  active={sortKey === "winningPercent"}
                  dir={sortDir}
                  accentText={theme.accentText}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Active Creatives"
                  sortKey="activeCreatives"
                  active={sortKey === "activeCreatives"}
                  dir={sortDir}
                  accentText={theme.accentText}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Main Duration (s)"
                  sortKey="totalDurationSeconds"
                  active={sortKey === "totalDurationSeconds"}
                  dir={sortDir}
                  accentText={theme.accentText}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="MVE Score"
                  sortKey="mveScore"
                  active={sortKey === "mveScore"}
                  dir={sortDir}
                  accentText={theme.accentText}
                  onSort={handleSort}
                />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-app-dim">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-app-dim">
                    No data for the selected filters.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.editorName}
                  onClick={() => setSelectedEditor(row.editorName)}
                  className={clsx("cursor-pointer border-b border-app-border/60 transition", theme.rowHover)}
                >
                  <td className="px-4 py-3 font-medium text-app-text">{row.editorName}</td>
                  <td className="px-4 py-3 text-app-muted">{row.videosSubmitted}</td>
                  <td className="px-4 py-3 text-app-muted">{row.mainAdsCount}</td>
                  <td className="px-4 py-3 text-app-muted">{row.winningCreatives}</td>
                  <td className="px-4 py-3 text-app-muted">{row.winningPercent}%</td>
                  <td className="px-4 py-3 text-app-muted">{row.activeCreatives}</td>
                  <td className="px-4 py-3 text-app-muted">{row.totalDurationSeconds.toLocaleString()}</td>
                  <td className="px-4 py-3 font-medium text-app-text">{row.mveScore ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedEditor && (
        <EditorDetailPanel
          editorName={selectedEditor}
          filters={filters}
          businessUnit={activeUnit === ALL_UNIT ? undefined : activeUnit}
          onClose={() => setSelectedEditor(null)}
        />
      )}
    </div>
  );
}
