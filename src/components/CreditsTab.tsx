"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import clsx from "clsx";
import { jsonFetcher } from "@/lib/swrFetcher";
import {
  aggregateDaily,
  aggregateOperators,
  computeKpis,
  firstNameKey,
  parseCreditsCsv,
  recentActivity,
  sortOperators,
  uniqueSorted,
  type CreditRow,
  type SortDir,
  type SortKey,
} from "@/lib/creditsDashboard";
import type { PerformanceData } from "@/lib/types";
import { UploadZone } from "./credits/UploadZone";
import { KpiCards } from "./credits/KpiCards";
import { OperatorTable, type EditorPerformanceLookup } from "./credits/OperatorTable";
import { DailyBreakdown } from "./credits/DailyBreakdown";
import { ActivityFeed } from "./credits/ActivityFeed";
import { CreditsPerClipEfficiencyChart, OperatorCreditsBarChart, OperatorShareDoughnutChart } from "./credits/Charts";

const fieldClass =
  "rounded-lg border border-credits-border bg-credits-bg px-2.5 py-1.5 text-sm text-credits-text focus:border-credits-accent focus:outline-none";

interface StoredCreditsData {
  rows: CreditRow[];
  fileName: string;
  uploadedAt: string;
}

// This tab has its own CSV, own filters, own state — independent of the rest of the dashboard's
// Google Sheets / Meta Ads data and shared filter bar (date range, editor filter). It does,
// though, cross-reference Performance data for the Credits/Main Ad and Credits/Duration columns
// below — fetched here directly, all-time and unfiltered, rather than wired to the shared
// FiltersBar, since a credits upload isn't scoped to whatever date range that bar happens to have.
export function CreditsTab() {
  const { data: stored, mutate: mutateStored } = useSWR<StoredCreditsData | null>("/api/credits", jsonFetcher);
  const { data: performanceData } = useSWR<PerformanceData>("/api/performance", jsonFetcher);

  const [allRows, setAllRows] = useState<CreditRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Hydrates local state from whatever's persisted server-side — the CSV used to live only in
  // React state, so a page refresh silently lost it. Also re-runs after a fresh upload's
  // mutateStored() call, but by then the values already match, so it's a no-op then.
  useEffect(() => {
    if (!stored) return;
    setAllRows(stored.rows);
    setFileName(stored.fileName);
    setLastUpdated(new Date(stored.uploadedAt).toLocaleString());
  }, [stored]);

  const [dateFilter, setDateFilter] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalCredits");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result ?? "");
      const { rows, missingColumns } = parseCreditsCsv(text);

      if (missingColumns.length > 0) {
        setUploadError(`CSV is missing required column(s): ${missingColumns.join(", ")}.`);
        return;
      }

      setUploadError(null);
      setAllRows(rows);
      setFileName(file.name);
      setLastUpdated(new Date().toLocaleString());
      setDateFilter("");
      setOperatorFilter("");

      // Persists the upload so it survives a refresh — replaces whatever was stored before, no
      // history of prior uploads is kept.
      const res = await fetch("/api/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, fileName: file.name }),
      });
      if (res.ok) {
        const saved = (await res.json()) as StoredCreditsData;
        mutateStored(saved, { revalidate: false });
      }
    };
    reader.readAsText(file);
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function handleReset() {
    setDateFilter("");
    setOperatorFilter("");
  }

  const dates = useMemo(() => uniqueSorted(allRows.map((r) => r.date)), [allRows]);
  const operatorNames = useMemo(() => uniqueSorted(allRows.map((r) => r.operator)), [allRows]);

  const filteredRows = useMemo(
    () =>
      allRows.filter(
        (r) => (!dateFilter || r.date === dateFilter) && (!operatorFilter || r.operator === operatorFilter)
      ),
    [allRows, dateFilter, operatorFilter]
  );

  // Keyed by firstNameKey, combined across every business unit — a credits CSV "operator" name
  // should match regardless of which account the editor's ads ran under. firstNameKey (not a
  // plain lowercase name) because the credits export uses login-style "Firstname.lastname"
  // operator names (e.g. "Roshan.Dubey") that an exact match against the Performance tab's names
  // ("Roshan Dubey", or just "Abhay" with no surname at all) would never line up with otherwise.
  const performanceByEditor = useMemo(() => {
    const map = new Map<string, EditorPerformanceLookup>();
    for (const row of performanceData?.rows ?? []) {
      if (row.editorName === "Unmapped") continue;
      const key = firstNameKey(row.editorName);
      const existing = map.get(key) ?? { mainAdsCount: 0, totalDurationSeconds: 0 };
      existing.mainAdsCount += row.mainAdsCount;
      existing.totalDurationSeconds += row.totalDurationSeconds;
      map.set(key, existing);
    }
    return map;
  }, [performanceData]);

  const kpis = useMemo(() => computeKpis(filteredRows), [filteredRows]);
  const operators = useMemo(() => aggregateOperators(filteredRows), [filteredRows]);
  const sortedOperators = useMemo(() => sortOperators(operators, sortKey, sortDir), [operators, sortKey, sortDir]);
  const daily = useMemo(() => aggregateDaily(filteredRows), [filteredRows]);
  const activity = useMemo(() => recentActivity(filteredRows, 50), [filteredRows]);
  const maxTotalCredits = useMemo(() => Math.max(0, ...operators.map((o) => o.totalCredits)), [operators]);

  return (
    <div className="rounded-2xl bg-credits-bg p-4 font-sans creditsmd:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-credits-text">AI Video Credit Consumption</h2>
        <span className="text-xs text-credits-muted">
          {lastUpdated ? `Last updated: ${lastUpdated}` : "No data uploaded yet"}
        </span>
      </div>

      <div className="space-y-4">
        <UploadZone fileName={fileName} rowCount={allRows.length} onFile={handleFile} />
        {uploadError && <p className="text-sm text-red-400">{uploadError}</p>}

        {allRows.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-credits-border bg-credits-card p-3">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-credits-muted">Date</label>
                <select className={fieldClass} value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
                  <option value="">All Dates</option>
                  {dates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-credits-muted">Operator</label>
                <select className={fieldClass} value={operatorFilter} onChange={(e) => setOperatorFilter(e.target.value)}>
                  <option value="">All Operators</option>
                  {operatorNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleReset}
                className={clsx("ml-auto rounded-lg px-2.5 py-1.5 text-sm text-credits-muted hover:bg-credits-bg")}
              >
                Reset
              </button>
            </div>

            <KpiCards kpis={kpis} />

            <div className="grid grid-cols-1 gap-4 creditsmd:grid-cols-3">
              <div className="rounded-xl border border-credits-border bg-credits-card p-4 creditsmd:col-span-2">
                <h3 className="mb-3 text-sm font-semibold text-credits-text">Total Credits by Operator</h3>
                <OperatorCreditsBarChart operators={operators} />
              </div>
              <div className="rounded-xl border border-credits-border bg-credits-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-credits-text">Share of Consumption</h3>
                <OperatorShareDoughnutChart operators={operators} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 creditsmd:grid-cols-2">
              <DailyBreakdown daily={daily} />
              <div className="rounded-xl border border-credits-border bg-credits-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-credits-text">Avg Credits/Clip (Efficiency)</h3>
                <CreditsPerClipEfficiencyChart operators={operators} />
              </div>
            </div>

            <OperatorTable
              operators={sortedOperators}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              maxTotalCredits={maxTotalCredits}
              performanceByEditor={performanceByEditor}
            />

            <ActivityFeed rows={activity} />
          </>
        )}
      </div>
    </div>
  );
}
