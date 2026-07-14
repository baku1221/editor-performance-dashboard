"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import clsx from "clsx";
import { jsonFetcher } from "@/lib/swrFetcher";
import { buildQueryString, type UiFilters } from "@/lib/clientFilters";
import type { EditorDetail } from "@/lib/types";

const UNIT_ACCENT: Record<string, string> = {
  Lumus: "border-purple-800/50 bg-purple-950/40",
  Astrotalk: "border-yellow-800/50 bg-yellow-950/40",
  "Astrotalk Store": "border-teal-800/50 bg-teal-950/40",
};

// Same colors as UNIT_ACCENT, just compact enough for an inline table badge — most useful in the
// "All" combined view, where one editor's ads from every business unit are listed together.
const UNIT_BADGE: Record<string, string> = {
  Lumus: "bg-purple-500/15 text-purple-300",
  Astrotalk: "bg-yellow-500/15 text-yellow-300",
  "Astrotalk Store": "bg-teal-500/15 text-teal-300",
};

export function EditorDetailPanel({
  editorName,
  filters,
  businessUnit,
  onClose,
}: {
  editorName: string;
  filters: UiFilters;
  businessUnit?: string;
  onClose: () => void;
}) {
  const query = buildQueryString(filters);
  const fullQuery = businessUnit ? `${query}&businessUnit=${encodeURIComponent(businessUnit)}` : query;
  const { data, isLoading } = useSWR<EditorDetail>(
    `/api/performance/${encodeURIComponent(editorName)}?${fullQuery}`,
    jsonFetcher
  );

  const [includeCuts, setIncludeCuts] = useState(false);

  const mainCount = useMemo(() => data?.videos.filter((v) => v.videoKind === "Main").length ?? 0, [data]);
  const cutCount = useMemo(() => data?.videos.filter((v) => v.videoKind === "Cut").length ?? 0, [data]);
  const otherCount = (data?.videos.length ?? 0) - mainCount - cutCount;

  // Default view: Main only. "Include cuts" reveals every ad (Main + Cut + unclassified).
  const visibleVideos = useMemo(() => {
    if (!data) return [];
    return includeCuts ? data.videos : data.videos.filter((v) => v.videoKind === "Main");
  }, [data, includeCuts]);

  const accentClass = (businessUnit && UNIT_ACCENT[businessUnit]) || "border-app-border bg-app-bg";
  // Astrotalk Store's winning rule is spend-based (a Purchase-objective account), not CPI like
  // the other two — showing CPI there would be a number nobody set a target for.
  const showSpendInsteadOfCpi = businessUnit === "Astrotalk Store";

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={clsx("flex items-center justify-between border-b px-6 py-4", accentClass)}>
          <div>
            <h2 className="text-lg font-semibold text-app-text">{editorName}</h2>
            {businessUnit && <span className="text-xs text-app-muted">{businessUnit}</span>}
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
            <p className="text-sm text-app-muted">No submitted videos in the selected period.</p>
          )}

          {data && data.videos.length > 0 && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-app-border bg-app-bg px-4 py-3">
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <span className="text-sm text-app-muted">Showing: </span>
                    <span className="text-lg font-semibold text-app-text">{visibleVideos.length}</span>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="rounded-full bg-purple-500/15 px-2.5 py-1 font-medium text-purple-300">Main: {mainCount}</span>
                    <span className="rounded-full bg-yellow-500/15 px-2.5 py-1 font-medium text-yellow-300">Cuts: {cutCount}</span>
                    {otherCount > 0 && (
                      <span className="rounded-full bg-app-border px-2.5 py-1 font-medium text-app-muted">Other: {otherCount}</span>
                    )}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-app-muted">
                  <input
                    type="checkbox"
                    checked={includeCuts}
                    onChange={(e) => setIncludeCuts(e.target.checked)}
                    className="h-4 w-4 rounded border-app-border bg-app-bg text-purple-600 focus:ring-purple-500"
                  />
                  Include cuts (show all ads)
                </label>
              </div>

              <div className="overflow-x-auto rounded-xl border border-app-border">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-app-border bg-app-bg text-app-muted">
                      <th className="px-3 py-2.5 font-medium">Ad Name</th>
                      <th className="px-3 py-2.5 font-medium">Business Unit</th>
                      <th className="px-3 py-2.5 font-medium">Campaign</th>
                      <th className="px-3 py-2.5 font-medium">Type</th>
                      <th className="px-3 py-2.5 font-medium">Created Date</th>
                      <th className="px-3 py-2.5 font-medium">Published Date</th>
                      <th className="px-3 py-2.5 font-medium">Duration (s)</th>
                      <th className="px-3 py-2.5 font-medium">Taken Live</th>
                      <th className="px-3 py-2.5 font-medium">{showSpendInsteadOfCpi ? "Spend" : "CPI"}</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">Winning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleVideos.length === 0 && (
                      <tr>
                        <td colSpan={11} className="px-3 py-6 text-center text-app-dim">
                          No Main-version ads in the selected period — try "Include cuts".
                        </td>
                      </tr>
                    )}
                    {visibleVideos.map((video, index) => (
                      <tr
                        key={video.id}
                        className={clsx(
                          "border-b border-app-border/60 last:border-0 hover:bg-white/5",
                          index % 2 === 1 && "bg-white/[0.02]"
                        )}
                      >
                        <td className="px-3 py-2.5 text-app-text">{video.adName}</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={clsx(
                              "rounded-full px-2 py-0.5 text-xs font-medium",
                              UNIT_BADGE[video.businessUnit] ?? "bg-app-border text-app-muted"
                            )}
                          >
                            {video.businessUnit}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-app-muted">{video.campaignName || "—"}</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={clsx(
                              "rounded-full px-2 py-0.5 text-xs font-medium",
                              video.videoKind === "Main"
                                ? "bg-purple-500/15 text-purple-300"
                                : video.videoKind === "Cut"
                                  ? "bg-yellow-500/15 text-yellow-300"
                                  : "bg-app-border text-app-muted"
                            )}
                          >
                            {video.videoKind ?? "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-app-muted">{video.sheetCreatedDate || "—"}</td>
                        <td className="px-3 py-2.5 text-app-muted">{video.publishedDate || "—"}</td>
                        <td className="px-3 py-2.5 text-app-muted">{video.durationSeconds ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          {video.takenLive ? (
                            <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-300">Yes</span>
                          ) : (
                            <span className="rounded-full bg-app-border px-2 py-0.5 text-xs font-medium text-app-muted">Not yet</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-app-muted">
                          {!video.takenLive
                            ? "—"
                            : showSpendInsteadOfCpi
                              ? video.spend.toFixed(2)
                              : video.cpa !== null
                                ? video.cpa.toFixed(2)
                                : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-app-muted">{video.effectiveStatus}</td>
                        <td className="px-3 py-2.5">
                          {video.isWinning ? (
                            <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-300">
                              Winning
                            </span>
                          ) : (
                            <span className="text-app-dim">—</span>
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
    </div>
  );
}
