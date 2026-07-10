"use client";

import { useCallback, useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import clsx from "clsx";
import { emptyFilters, type UiFilters } from "@/lib/clientFilters";
import { FiltersBar } from "./FiltersBar";
import { SyncButton } from "./SyncButton";
import { PerformanceTab } from "./PerformanceTab";
import { ProgressTab } from "./ProgressTab";
import { CreditsTab } from "./CreditsTab";

type TabKey = "performance" | "progress" | "credits";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "performance", label: "Performance" },
  { key: "progress", label: "Daily Progress" },
  { key: "credits", label: "AI Credits" },
];

export function DashboardShell() {
  const [filters, setFilters] = useState<UiFilters>(emptyFilters);
  const [activeTab, setActiveTab] = useState<TabKey>("performance");
  const { mutate } = useSWRConfig();

  const revalidateAll = useCallback(() => {
    mutate(() => true);
  }, [mutate]);

  useEffect(() => {
    // "Fetch the latest Meta Ads metrics when the dashboard loads" + Sheets sync.
    fetch("/api/sync", { method: "POST" })
      .then(revalidateAll)
      .catch(() => {
        // Per-source failures are surfaced by SyncButton's status indicator.
      });
  }, [revalidateAll]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-app-text">Editor Performance Dashboard</h1>
          <p className="text-sm text-app-muted">Productivity, creative performance, progress, and AI credit usage.</p>
        </div>
        <SyncButton onSynced={revalidateAll} />
      </div>

      <FiltersBar filters={filters} onChange={setFilters} />

      <div className="flex gap-1 border-b border-app-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={clsx(
              "px-4 py-2 text-sm font-medium transition",
              activeTab === tab.key
                ? "border-b-2 border-purple-400 text-purple-300"
                : "text-app-muted hover:text-app-text"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "performance" && <PerformanceTab filters={filters} />}
      {activeTab === "progress" && <ProgressTab filters={filters} />}
      {activeTab === "credits" && <CreditsTab />}
    </div>
  );
}
