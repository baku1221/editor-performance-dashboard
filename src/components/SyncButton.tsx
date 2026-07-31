"use client";

import { useState } from "react";
import useSWR from "swr";
import clsx from "clsx";
import { jsonFetcher } from "@/lib/swrFetcher";
import type { SyncStatus } from "@/lib/types";

const SOURCE_LABELS: Record<keyof SyncStatus["sources"], string> = {
  googleSheetsProgress: "Progress Tracker sheet",
  metaAds: "Meta Ads",
};

export function SyncButton({ onSynced }: { onSynced: () => void }) {
  const { data, mutate } = useSWR<SyncStatus>("/api/sync", jsonFetcher);
  // Tracked per endpoint so clicking one doesn't show the other as "Syncing…" too.
  const [syncing, setSyncing] = useState<"sheets" | "meta" | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function handleSync(endpoint: string, which: "sheets" | "meta") {
    setSyncing(which);
    setSyncError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        // Non-admin (see the route's POST handler) — the buttons stay visible to everyone, same
        // pattern as "+ Add editor", but the action itself is server-rejected with a clear reason.
        setSyncError(body.error ?? "Sync failed.");
        return;
      }
      const status = body as SyncStatus;
      await mutate(status, { revalidate: false });
      onSynced();
    } catch {
      // Server unreachable (dev server restart, network blip) — surface it via the status dot's
      // tooltip instead of letting the fetch rejection bubble up and crash the whole page.
      setSyncError("Couldn't reach the server. Try again in a moment.");
    } finally {
      setSyncing(null);
    }
  }

  const hasFailure = Boolean(syncError) || (data ? Object.values(data.sources).some((s) => !s.ok && s.fetchedAt === null) : false);

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => handleSync("/api/sync/sheets", "sheets")}
        disabled={syncing !== null}
        className={clsx(
          "rounded-lg px-3 py-1.5 text-sm font-medium transition",
          syncing === "sheets" ? "bg-app-border text-app-muted" : "border border-app-border text-app-text hover:bg-app-border"
        )}
      >
        {syncing === "sheets" ? "Syncing…" : "Sync Sheets"}
      </button>
      <button
        onClick={() => handleSync("/api/sync", "meta")}
        disabled={syncing !== null}
        className={clsx(
          "rounded-lg px-3 py-1.5 text-sm font-medium text-white transition",
          syncing === "meta" ? "bg-app-border" : "bg-purple-600 hover:bg-purple-500"
        )}
      >
        {syncing === "meta" ? "Syncing…" : "Sync Meta"}
      </button>
      <div className="group relative">
        <span
          className={clsx(
            "inline-block h-2.5 w-2.5 rounded-full",
            hasFailure ? "bg-red-500" : data?.lastSyncedAt ? "bg-green-500" : "bg-gray-300"
          )}
        />
        <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-72 -translate-x-1/2 rounded-lg bg-gray-900 p-3 text-xs text-white opacity-0 shadow-lg transition group-hover:opacity-100">
          <div className="mb-1 font-medium">
            {data?.lastSyncedAt ? `Last synced ${new Date(data.lastSyncedAt).toLocaleString()}` : "Not synced yet"}
          </div>
          {syncError && <div className="text-red-400">{syncError}</div>}
          {data &&
            (Object.entries(data.sources) as [keyof SyncStatus["sources"], SyncStatus["sources"][keyof SyncStatus["sources"]]][]).map(
              ([key, s]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span className={clsx("h-1.5 w-1.5 rounded-full", s.ok ? "bg-green-400" : "bg-red-400")} />
                  <span>
                    {SOURCE_LABELS[key]}
                    {s.message ? `: ${s.message}` : ""}
                  </span>
                </div>
              )
            )}
        </div>
      </div>
    </div>
  );
}
