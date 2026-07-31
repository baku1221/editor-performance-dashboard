import { config } from "../../config";
import { fetchSheetTable } from "./client";
import { normalizeTitleForMatching } from "./driveCreatives";
import type { MetaAdRecord, MetaAdsIndex } from "../metaAds/videos";

// Column order must match sheetBackfillService.ts's HEADERS exactly.
const COL = {
  adId: 0,
  businessUnit: 1,
  editor: 2,
  adName: 3,
  videoKind: 4,
  campaignId: 5,
  campaignName: 6,
  createdDate: 7,
  publishedDate: 8,
  status: 9,
  takenLive: 10,
  spend: 11,
  impressions: 12,
  ctr: 13,
  cpm: 14,
  cpc: 15,
  conversions: 16,
  cpa: 17,
  durationSeconds: 18,
  winning: 19,
  winningSource: 20,
  allCampaignIds: 21, // appended after the original 21 columns — see sheetBackfillService.ts HEADERS
} as const;

function cell(row: string[], index: number): string {
  return (row[index] ?? "").trim();
}

function numberOrZero(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numberOrNull(value: string): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function emptyIndex(): MetaAdsIndex {
  return {
    byAdId: new Map(),
    byNormalizedTitle: new Map(),
    earliestCreatedByNormalizedTitle: new Map(),
    campaignIdsByNormalizedTitle: new Map(),
    all: [],
  };
}

/**
 * Rebuilds a MetaAdsIndex-shaped lookup from the backfill sheet's own previously-written rows —
 * used as a fallback enrichment source on days runSync deliberately skips a live Meta fetch (see
 * config.metaSyncMinIntervalHours), so "Taken Live"/spend/campaign/etc. for ads that were live as
 * of the last real Meta sync don't silently revert to "Not Live" just because Meta wasn't
 * re-queried today. Only rows genuinely taken live (per the sheet's own "Taken Live" column) are
 * indexed — a sheet-only row (never matched to Meta) has no live-ad data to contribute anyway.
 * durationSeconds is deliberately NOT read back here — that's still resolved fresh from Drive
 * every sync (already cheap and cached, see googleDrive/client.ts), independent of Meta.
 */
export async function fetchMetaIndexFromBackfillSheet(businessUnits: string[]): Promise<MetaAdsIndex> {
  const index = emptyIndex();
  if (!config.sheetBackfill.sheetId) return index;

  // In parallel, not sequential — each business unit's tab is an independent read; awaiting them
  // one at a time needlessly adds up (confirmed real case: this was a meaningful chunk of a
  // 9-minute "Sync Sheets" call). Merging into the shared index happens after every fetch
  // resolves, not during, so there's no concurrent-mutation concern.
  const perUnitRows = await Promise.all(
    businessUnits.map(async (businessUnit) => {
      try {
        const { rows } = await fetchSheetTable(config.sheetBackfill.sheetId, businessUnit);
        return { businessUnit, rows };
      } catch (err) {
        console.error(`[backfillReader] Skipping business unit "${businessUnit}" — read failed:`, err);
        return { businessUnit, rows: [] as string[][] };
      }
    })
  );

  for (const { businessUnit, rows } of perUnitRows) {
    for (const row of rows) {
      if (cell(row, COL.takenLive).toLowerCase() !== "yes") continue;
      const adId = cell(row, COL.adId);
      if (!adId) continue;

      const adName = cell(row, COL.adName);
      const record: MetaAdRecord = {
        id: adId,
        accountId: "",
        businessUnit: cell(row, COL.businessUnit) || businessUnit,
        campaignId: cell(row, COL.campaignId),
        campaignName: cell(row, COL.campaignName),
        adName,
        createdDate: cell(row, COL.publishedDate) || cell(row, COL.createdDate),
        effectiveStatus: cell(row, COL.status),
        spend: numberOrZero(cell(row, COL.spend)),
        impressions: numberOrZero(cell(row, COL.impressions)),
        ctr: numberOrZero(cell(row, COL.ctr)),
        cpm: numberOrZero(cell(row, COL.cpm)),
        cpc: numberOrZero(cell(row, COL.cpc)),
        conversions: numberOrNull(cell(row, COL.conversions)),
        cpa: numberOrNull(cell(row, COL.cpa)),
        durationSeconds: numberOrNull(cell(row, COL.durationSeconds)),
      };

      const key = normalizeTitleForMatching(record.adName);
      index.byAdId.set(record.id, record);
      index.byNormalizedTitle.set(key, record);
      const existingEarliest = index.earliestCreatedByNormalizedTitle.get(key);
      if (!existingEarliest || record.createdDate < existingEarliest) {
        index.earliestCreatedByNormalizedTitle.set(key, record.createdDate);
      }
      // "All Campaign IDs" is pipe-joined by sheetBackfillService.ts's toRow — a row written
      // before that column existed reads back as "", so it falls back to just this row's own
      // campaignId (better than nothing, though it can't recover a sibling duplicate's campaign
      // until the next live Meta sync rewrites this row with the full set).
      const allCampaignIdsCell = cell(row, COL.allCampaignIds);
      const rowCampaignIds = allCampaignIdsCell
        ? allCampaignIdsCell.split("|").map((s) => s.trim()).filter(Boolean)
        : record.campaignId
          ? [record.campaignId]
          : [];
      if (rowCampaignIds.length > 0) {
        index.campaignIdsByNormalizedTitle.set(key, new Set(rowCampaignIds));
      }
      index.all.push(record);
    }
  }

  return index;
}
