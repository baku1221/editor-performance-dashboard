"use client";

import { useState } from "react";
import useSWR from "swr";
import clsx from "clsx";
import { jsonFetcher } from "@/lib/swrFetcher";
import { buildQueryString, type UiFilters } from "@/lib/clientFilters";
import type { MainAdsDetail, PublishedVideo } from "@/lib/types";
import { AdVersionsPanel } from "./AdVersionsPanel";

// Same display-only relabeling as PerformanceTab.tsx/EditorDetailPanel.tsx — the internal
// businessUnit string stays "Astrotalk" everywhere else; only what's shown here changes.
const BUSINESS_UNIT_DISPLAY_LABEL: Record<string, string> = {
  Astrotalk: "Astrotalk Foreign",
};

function displayLabelFor(unit: string): string {
  return BUSINESS_UNIT_DISPLAY_LABEL[unit] ?? unit;
}

export function MainAdsDetailPanel({
  businessUnit,
  filters,
  onClose,
}: {
  businessUnit: string;
  filters: UiFilters;
  onClose: () => void;
}) {
  const query = buildQueryString(filters);
  const { data, isLoading } = useSWR<MainAdsDetail>(
    `/api/performance/main-ads?${query}&businessUnit=${encodeURIComponent(businessUnit)}`,
    jsonFetcher
  );
  const [selectedAd, setSelectedAd] = useState<PublishedVideo | null>(null);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-app-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-app-text">Main Ads</h2>
            <span className="text-xs text-app-muted">{displayLabelFor(businessUnit)}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2.5 py-1.5 text-sm text-app-muted transition hover:bg-white/10 hover:text-app-text"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading && <p className="text-sm text-app-muted">Loading…</p>}

          {data && data.videos.length === 0 && (
            <p className="text-sm text-app-muted">No Main ads in the selected period.</p>
          )}

          {data && data.videos.length > 0 && (
            <>
              <p className="mb-4 text-sm text-app-muted">
                Showing <span className="font-semibold text-app-text">{data.videos.length}</span> Main ads
              </p>

              <div className="overflow-x-auto rounded-xl border border-app-border">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-app-border bg-app-bg text-app-muted">
                      <th className="px-3 py-2.5 font-medium">Ad Title</th>
                      <th className="px-3 py-2.5 font-medium">Editor</th>
                      <th className="px-3 py-2.5 font-medium">Date Made</th>
                      <th className="px-3 py-2.5 font-medium">Date Taken Live</th>
                      <th className="px-3 py-2.5 font-medium">Scaled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.videos.map((video, index) => (
                      <tr
                        key={video.id}
                        onClick={() => setSelectedAd(video)}
                        className={clsx(
                          "cursor-pointer border-b border-app-border/60 last:border-0 hover:bg-white/5",
                          index % 2 === 1 && "bg-white/[0.02]"
                        )}
                      >
                        <td className="px-3 py-2.5 text-app-text">{video.adName}</td>
                        <td className="px-3 py-2.5 text-app-muted">{video.editorName ?? "Unmapped"}</td>
                        <td className="px-3 py-2.5 text-app-muted">{video.sheetCreatedDate || "—"}</td>
                        <td className="px-3 py-2.5 text-app-muted">{video.publishedDate || "—"}</td>
                        <td className="px-3 py-2.5">
                          {video.isWinning ? (
                            <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-300">
                              Yes
                            </span>
                          ) : (
                            <span className="rounded-full bg-app-border px-2 py-0.5 text-xs font-medium text-app-muted">
                              No
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {selectedAd && (
        <AdVersionsPanel
          businessUnit={businessUnit}
          adId={selectedAd.id}
          adTitle={selectedAd.adName}
          filters={filters}
          onClose={() => setSelectedAd(null)}
        />
      )}
    </div>
  );
}
