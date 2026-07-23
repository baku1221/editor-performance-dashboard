"use client";

import { useState } from "react";
import useSWR from "swr";
import clsx from "clsx";
import { jsonFetcher } from "@/lib/swrFetcher";
import { buildQueryString, type UiFilters } from "@/lib/clientFilters";
import type { ScriptWriterRow } from "@/lib/types";
import { SummaryCard } from "./SummaryCard";
import { ScriptWriterDetailPanel } from "./ScriptWriterDetailPanel";

type ScriptWriterGroup = "Foreign" | "India";
type SortKey = "scriptsGiven" | "winningCreatives" | "winningPercent";
type SortDir = "asc" | "desc";

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
  const { data, isLoading } = useSWR<ScriptWriterRow[]>(`/api/scriptwriters?${query}&group=${group}`, jsonFetcher);
  // The India sub-tab itself is hidden from anyone not on the allowlist — the allowlist stays
  // server-side (see /api/scriptwriters/access), this just tells the client whether to render the
  // button at all. The API routes enforce this independently, so hiding the button is a UX nicety,
  // not the actual security boundary.
  const { data: access } = useSWR<{ canViewIndia: boolean }>("/api/scriptwriters/access", jsonFetcher);
  const groups: Array<{ key: ScriptWriterGroup; label: string }> = access?.canViewIndia
    ? [
        { key: "Foreign", label: "Foreign" },
        { key: "India", label: "India" },
      ]
    : [{ key: "Foreign", label: "Foreign" }];
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

  function handleSelectGroup(next: ScriptWriterGroup) {
    setGroup(next);
    setSelectedWriter(null);
  }

  const rows = sortRows(data ?? [], sortKey, sortDir);
  const totalScripts = rows.reduce((sum, r) => sum + r.scriptsGiven, 0);
  const totalWinning = rows.reduce((sum, r) => sum + r.winningCreatives, 0);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-app-border bg-app-card p-1 shadow-sm w-fit">
        {groups.map((g) => (
          <button
            key={g.key}
            onClick={() => handleSelectGroup(g.key)}
            className={clsx(
              "rounded-md px-4 py-1.5 text-sm font-medium transition",
              group === g.key ? "bg-purple-600 text-white" : "text-app-muted hover:bg-white/5 hover:text-app-text"
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        <SummaryCard label="Total Scripts Given" value={totalScripts} />
        <SummaryCard label="Total Winning" value={totalWinning} />
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
                <td className="px-4 py-3 text-app-muted">{row.winningCreatives}</td>
                <td className="px-4 py-3 text-app-muted">{row.winningPercent}%</td>
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
