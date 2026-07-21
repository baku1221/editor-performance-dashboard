"use client";

import { useCallback, useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { useSession, signOut } from "next-auth/react";
import clsx from "clsx";
import { defaultFilters, type UiFilters } from "@/lib/clientFilters";
import { FiltersBar } from "./FiltersBar";
import { SyncButton } from "./SyncButton";
import { PerformanceTab } from "./PerformanceTab";
import { ProgressTab } from "./ProgressTab";
import { CreditsTab } from "./CreditsTab";
import { ScriptWriterTab } from "./ScriptWriterTab";

type TeamView = "editor" | "copywriter";
type TabKey = "performance" | "progress" | "credits";

const TEAM_VIEWS: Array<{ key: TeamView; label: string }> = [
  { key: "editor", label: "Editor" },
  { key: "copywriter", label: "Copy Writer" },
];

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "performance", label: "Performance" },
  { key: "progress", label: "Daily Progress" },
  { key: "credits", label: "AI Credits" },
];

export function DashboardShell() {
  const [filters, setFilters] = useState<UiFilters>(defaultFilters);
  const [teamView, setTeamView] = useState<TeamView>("editor");
  const [activeTab, setActiveTab] = useState<TabKey>("performance");
  const { mutate } = useSWRConfig();
  const { data: session } = useSession();

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
          <h1 className="bg-gradient-to-r from-purple-300 via-purple-200 to-yellow-200 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
            Creative Team Performance Dashboard
          </h1>
          <p className="text-sm text-app-muted">Productivity, creative performance, progress, and AI credit usage.</p>
        </div>
        <div className="flex items-center gap-3">
          {session?.user?.email && (
            <span className="text-xs text-app-muted">
              {session.user.email} · <button onClick={() => signOut()} className="underline hover:text-app-text">Sign out</button>
            </span>
          )}
          <SyncButton onSynced={revalidateAll} />
        </div>
      </div>

      <FiltersBar filters={filters} onChange={setFilters} />

      <div className="flex gap-1 rounded-lg border border-app-border bg-app-card p-1 shadow-sm w-fit">
        {TEAM_VIEWS.map((view) => (
          <button
            key={view.key}
            onClick={() => setTeamView(view.key)}
            className={clsx(
              "rounded-md px-4 py-1.5 text-sm font-medium transition",
              teamView === view.key ? "bg-purple-600 text-white" : "text-app-muted hover:bg-white/5 hover:text-app-text"
            )}
          >
            {view.label}
          </button>
        ))}
      </div>

      {teamView === "editor" && (
        <>
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
        </>
      )}

      {teamView === "copywriter" && <ScriptWriterTab filters={filters} />}
    </div>
  );
}
