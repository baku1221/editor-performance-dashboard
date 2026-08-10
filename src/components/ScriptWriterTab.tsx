"use client";

import { useState } from "react";
import useSWR from "swr";
import clsx from "clsx";
import { jsonFetcher } from "@/lib/swrFetcher";
import { buildQueryString, type UiFilters } from "@/lib/clientFilters";
import type { ScriptWriterRow } from "@/lib/types";
import { SummaryCard } from "./SummaryCard";
import { ScriptWriterDetailPanel } from "./ScriptWriterDetailPanel";

type ScriptWriterGroup = "Foreign" | "India" | "In House Ads Astrotalk" | "In House Ads Lumus";
// The top-level tab row shows one "In House Ads" pill; which of its two sub-groups (Astrotalk/
// Lumus — split by each row's own Region cell, see inHouseAds.ts) is active is a second, nested
// tab row shown only once that top-level pill is selected — same nesting pattern as the
// Performance tab's business-unit sub-tabs.
type TopLevelTab = "Foreign" | "India" | "In House Ads";
type SortKey = "scriptsGiven" | "winningCreatives" | "winningPercent";
type SortDir = "asc" | "desc";

const TOP_LEVEL_TABS: Array<{ key: TopLevelTab; label: string }> = [
  { key: "Foreign", label: "Foreign" },
  { key: "India", label: "India" },
  { key: "In House Ads", label: "In House Ads" },
];

const IN_HOUSE_ADS_SUBGROUPS: Array<{ key: ScriptWriterGroup; label: string }> = [
  { key: "In House Ads Astrotalk", label: "Astrotalk" },
  { key: "In House Ads Lumus", label: "Lumus" },
];

function topLevelOf(group: ScriptWriterGroup): TopLevelTab {
  return group.startsWith("In House Ads") ? "In House Ads" : (group as TopLevelTab);
}

// In House Ads has no live Meta data behind it yet (see config.ts's inHouseAdsSheets doc
// comment) — winningCreatives/winningPercent are always 0 for this group, which would read as
// "nobody's work is winning" rather than "not tracked yet". Shown as "—" instead so it's clearly
// a different kind of blank, not a real zero.
function tracksWinning(group: ScriptWriterGroup): boolean {
  return !group.startsWith("In House Ads");
}

function sortRows(rows: ScriptWriterRow[], sortKey: SortKey, sortDir: SortDir): ScriptWriterRow[] {
  const sorted = [...rows].sort((a, b) => a[sortKey] - b[sortKey]);
  return sortDir === "desc" ? sorted.reverse() : sorted;
}

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
    <th onClick={() => onSort(sortKey)} className={clsx("cursor-pointer select-none px-4 py-3 font-medium", active && "text-purple-300")}>
      {label}
      {active ? (dir === "desc" ? " ↓" : " ↑") : ""}
    </th>
  );
}

export function ScriptWriterTab({ filters }: { filters: UiFilters }) {
  const [group, setGroup] = useState<ScriptWriterGroup>("Foreign");
  const query = buildQueryString(filters);
  const { data, isLoading } = useSWR<ScriptWriterRow[]>(`/api/scriptwriters?${query}&group=${encodeURIComponent(group)}`, jsonFetcher);
  const [selectedWriter, setSelectedWriter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("scriptsGiven");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function handleSelectTopLevel(next: TopLevelTab) {
    if (next === "In House Ads") {
      // Default to the first sub-group unless one's already active (switching Foreign <-> India
      // <-> In House Ads and back shouldn't reset which In House Ads sub-tab was selected).
      if (topLevelOf(group) !== "In House Ads") setGroup("In House Ads Astrotalk");
    } else {
      setGroup(next);
    }
    setSelectedWriter(null);
  }

  function handleSelectSubGroup(next: ScriptWriterGroup) {
    setGroup(next);
    setSelectedWriter(null);
  }

  const rows = sortRows(data ?? [], sortKey, sortDir);
  const totalScripts = rows.reduce((sum, r) => sum + r.scriptsGiven, 0);
  const totalWinning = rows.reduce((sum, r) => sum + r.winningCreatives, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-app-border bg-app-card p-1 shadow-sm w-fit">
          {TOP_LEVEL_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => handleSelectTopLevel(t.key)}
              className={clsx(
                "rounded-md px-4 py-1.5 text-sm font-medium transition",
                topLevelOf(group) === t.key ? "bg-purple-600 text-white" : "text-app-muted hover:bg-white/5 hover:text-app-text"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {topLevelOf(group) === "In House Ads" && (
          <div className="flex gap-1 rounded-lg border border-app-border bg-app-card p-1 shadow-sm w-fit">
            {IN_HOUSE_ADS_SUBGROUPS.map((g) => (
              <button
                key={g.key}
                onClick={() => handleSelectSubGroup(g.key)}
                className={clsx(
                  "rounded-md px-3 py-1 text-xs font-medium transition",
                  group === g.key ? "bg-purple-500/70 text-white" : "text-app-muted hover:bg-white/5 hover:text-app-text"
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        <SummaryCard label="Total Scripts Given" value={totalScripts} />
        <SummaryCard label="Total Winning" value={tracksWinning(group) ? totalWinning : "—"} />
        <SummaryCard label="Script Writers" value={rows.length} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-app-border bg-app-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-app-border bg-app-bg text-app-muted">
              <th className="px-4 py-3 font-medium">Script Writer</th>
              <SortableHeader label="Scripts Given" sortKey="scriptsGiven" active={sortKey === "scriptsGiven"} dir={sortDir} onSort={handleSort} />
              <SortableHeader
                label="Winning Creatives"
                sortKey="winningCreatives"
                active={sortKey === "winningCreatives"}
                dir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader label="Winning %" sortKey="winningPercent" active={sortKey === "winningPercent"} dir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-app-dim">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-app-dim">
                  No data for the selected filters.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr
                key={row.scriptWriter}
                onClick={() => setSelectedWriter(row.scriptWriter)}
                className="cursor-pointer border-b border-app-border/60 transition hover:bg-white/5"
              >
                <td className="px-4 py-3 font-medium text-app-text">{row.scriptWriter}</td>
                <td className="px-4 py-3 text-app-muted">{row.scriptsGiven}</td>
                <td className="px-4 py-3 text-app-muted">{tracksWinning(group) ? row.winningCreatives : "—"}</td>
                <td className="px-4 py-3 text-app-muted">{tracksWinning(group) ? `${row.winningPercent}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedWriter && (
        <ScriptWriterDetailPanel scriptWriter={selectedWriter} filters={filters} group={group} onClose={() => setSelectedWriter(null)} />
      )}
    </div>
  );
}
