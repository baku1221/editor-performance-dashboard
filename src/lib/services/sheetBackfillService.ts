import type { PublishedVideo } from "../types";
import { backfillBusinessUnitRows, isSheetBackfillConfigured } from "../datasources/googleSheets/backfillWriter";

// Column A (Ad ID) is the unique key the Apps Script matches existing rows against — keep it
// first if this list ever changes.
const HEADERS = [
  "Ad ID",
  "Business Unit",
  "Editor",
  "Ad Name",
  "Video Kind",
  "Campaign ID",
  "Campaign",
  "Created Date",
  "Published Date",
  "Status",
  "Taken Live",
  "Spend",
  "Impressions",
  "CTR",
  "CPM",
  "CPC",
  "Conversions",
  "CPA",
  "Duration (s)",
  "Winning",
  "Winning Source",
];

function toRow(video: PublishedVideo): Array<string | number> {
  return [
    video.id,
    video.businessUnit,
    video.editorName ?? "",
    video.adName,
    video.videoKind ?? "",
    video.campaignId,
    video.campaignName,
    video.createdDate,
    video.publishedDate ?? "",
    video.effectiveStatus,
    video.takenLive ? "Yes" : "No",
    video.spend,
    video.impressions,
    video.ctr,
    video.cpm,
    video.cpc,
    video.conversions ?? "",
    video.cpa ?? "",
    video.durationSeconds ?? "",
    video.isWinning ? "Yes" : "No",
    video.winningSource ?? "",
  ];
}

/**
 * Backfills the configured Google Sheet "database" (one tab per business unit) with the latest
 * synced videos, so the dashboard's own data survives independently of re-syncing from Meta/
 * Sheets/Drive. Best-effort per business unit — a failure backfilling one tab (e.g. a transient
 * Apps Script hiccup) shouldn't stop the others, and none of this is fatal to the sync itself,
 * since this sheet is a convenience copy, not the primary data source.
 */
export async function backfillDatabaseSheet(videos: PublishedVideo[]): Promise<void> {
  if (!isSheetBackfillConfigured()) return;

  const byBusinessUnit = new Map<string, PublishedVideo[]>();
  for (const video of videos) {
    const list = byBusinessUnit.get(video.businessUnit) ?? [];
    list.push(video);
    byBusinessUnit.set(video.businessUnit, list);
  }

  // In parallel, not sequential — confirmed real case: 7 business units awaited one at a time
  // (each its own Apps Script round trip, doing a bulk read+merge+write of a 1000+ row tab) added
  // up to minutes of pure serial wait, when every unit's write is fully independent of the others.
  await Promise.all(
    Array.from(byBusinessUnit.entries()).map(async ([businessUnit, unitVideos]) => {
      try {
        await backfillBusinessUnitRows(businessUnit, HEADERS, unitVideos.map(toRow));
      } catch (err) {
        console.error(`[sheetBackfill] Failed to backfill "${businessUnit}":`, err);
      }
    })
  );
}
