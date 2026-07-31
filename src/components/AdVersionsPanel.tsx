"use client";

import useSWR from "swr";
import clsx from "clsx";
import { jsonFetcher } from "@/lib/swrFetcher";
import { buildQueryString, type UiFilters } from "@/lib/clientFilters";
import type { PublishedVideo } from "@/lib/types";

/** Every version (Main + Cuts) of the ad the user clicked into from the Main Ads drill-down —
 * this is where CPI actually lives, since a scaling-campaign promotion (and its CPI) can land on
 * any individual Cut, not necessarily the Main itself. */
export function AdVersionsPanel({
  businessUnit,
  adId,
  adTitle,
  filters,
  onClose,
}: {
  businessUnit: string;
  adId: string;
  adTitle: string;
  filters: UiFilters;
  onClose: () => void;
}) {
  const query = buildQueryString(filters);
  const { data, isLoading } = useSWR<{ videos: PublishedVideo[] }>(
    `/api/performance/ad-versions?${query}&businessUnit=${encodeURIComponent(businessUnit)}&adId=${encodeURIComponent(adId)}`,
    jsonFetcher
  );

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        // Nested inside MainAdsDetailPanel's own backdrop — without this, a click here would
        // bubble up and close BOTH panels instead of just this one.
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-app-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-app-text">All Versions</h2>
            <span className="text-xs text-app-muted">{adTitle.split("|")[0]?.trim() ?? adTitle}</span>
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

          {data && data.videos.length === 0 && <p className="text-sm text-app-muted">No versions found.</p>}

          {data && data.videos.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-app-border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-app-border bg-app-bg text-app-muted">
                    <th className="px-3 py-2.5 font-medium">Version</th>
                    <th className="px-3 py-2.5 font-medium">Ad Title</th>
                    <th className="px-3 py-2.5 font-medium">Taken Live</th>
                    <th className="px-3 py-2.5 font-medium">CPI</th>
                    <th className="px-3 py-2.5 font-medium">Scaled</th>
                  </tr>
                </thead>
                <tbody>
                  {data.videos.map((video, index) => (
                    <tr
                      key={video.id}
                      className={clsx("border-b border-app-border/60 last:border-0", index % 2 === 1 && "bg-white/[0.02]")}
                    >
                      <td className="px-3 py-2.5">
                        <span
                          className={clsx(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            video.videoKind === "Main" ? "bg-purple-500/15 text-purple-300" : "bg-yellow-500/15 text-yellow-300"
                          )}
                        >
                          {video.videoKind ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-app-text">{video.adName}</td>
                      <td className="px-3 py-2.5">
                        {video.takenLive ? (
                          <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-300">Yes</span>
                        ) : (
                          <span className="rounded-full bg-app-border px-2 py-0.5 text-xs font-medium text-app-muted">Not yet</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-app-muted">
                        {video.takenLive && video.cpa !== null ? video.cpa.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        {video.isWinning ? (
                          <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-300">Yes</span>
                        ) : (
                          <span className="rounded-full bg-app-border px-2 py-0.5 text-xs font-medium text-app-muted">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
