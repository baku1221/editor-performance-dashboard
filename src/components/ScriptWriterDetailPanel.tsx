"use client";

import useSWR from "swr";
import clsx from "clsx";
import { jsonFetcher } from "@/lib/swrFetcher";
import { buildQueryString, type UiFilters } from "@/lib/clientFilters";
import type { ScriptWriterDetail } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

export function ScriptWriterDetailPanel({
  scriptWriter,
  filters,
  onClose,
}: {
  scriptWriter: string;
  filters: UiFilters;
  onClose: () => void;
}) {
  const query = buildQueryString(filters);
  const { data, isLoading } = useSWR<ScriptWriterDetail>(
    `/api/scriptwriters/${encodeURIComponent(scriptWriter)}?${query}`,
    jsonFetcher
  );

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-app-border bg-app-bg px-6 py-4">
          <h2 className="text-lg font-semibold text-app-text">{scriptWriter}</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2.5 py-1.5 text-sm text-app-muted transition hover:bg-white/10 hover:text-app-text"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading && <p className="text-sm text-app-muted">Loading…</p>}

          {data && data.items.length === 0 && <p className="text-sm text-app-muted">No scripts in the selected period.</p>}

          {data && data.items.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-app-border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-app-border bg-app-bg text-app-muted">
                    <th className="px-3 py-2.5 font-medium">Script Name</th>
                    <th className="px-3 py-2.5 font-medium">Date</th>
                    <th className="px-3 py-2.5 font-medium">Editor</th>
                    <th className="px-3 py-2.5 font-medium">Cohort</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Taken Live</th>
                    <th className="px-3 py-2.5 font-medium">Winning Creative</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item, index) => (
                    <tr
                      key={item.id}
                      className={clsx("border-b border-app-border/60 last:border-0 hover:bg-white/5", index % 2 === 1 && "bg-white/[0.02]")}
                    >
                      <td className="px-3 py-2.5 text-app-text">{item.videoName}</td>
                      <td className="px-3 py-2.5 text-app-muted">{item.startedDate || "—"}</td>
                      <td className="px-3 py-2.5 text-app-muted">{item.editorName}</td>
                      <td className="px-3 py-2.5 text-app-muted">{item.cohort}</td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-3 py-2.5">
                        {item.matchedTakenLive === null ? (
                          <span className="text-app-dim">—</span>
                        ) : item.matchedTakenLive ? (
                          <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-300">Yes</span>
                        ) : (
                          <span className="rounded-full bg-app-border px-2 py-0.5 text-xs font-medium text-app-muted">Not yet</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {item.matchedIsWinning === null ? (
                          <span className="text-app-dim">—</span>
                        ) : item.matchedIsWinning ? (
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
