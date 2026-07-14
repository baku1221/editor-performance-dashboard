import type { PublishedVideo, SyncStatus } from "../types";
import { store } from "../cache/store";
import { config } from "../config";
import { fetchProgressTracker } from "../datasources/googleSheets/progressTracker";
import { fetchDriveCreativeRows, normalizeTitleForMatching, type DriveCreativeRow } from "../datasources/googleSheets/driveCreatives";
import { fetchMetaAdsIndex, type MetaAdRecord, type MetaAdsIndex } from "../datasources/metaAds/videos";
import { fetchDurationsForDriveLinks, isGoogleDriveConfigured } from "../datasources/googleDrive/client";
import {
  parseEditorFromAdTitle,
  parseVideoKindFromAdTitle,
  normalizeEditorName,
  matchEditorBySegmentScan,
  matchVideoKindByCutMention,
} from "../services/editorTitleParser";
import { progressRepository } from "../repositories/progressRepository";
import { publishedVideoRepository } from "../repositories/publishedVideoRepository";
import { applyWinningRule } from "./winningRule";

function titleWordSet(title: string): Set<string> {
  return new Set(normalizeTitleForMatching(title).split(" ").filter(Boolean));
}

/** True if one word set is fully contained in the other — a pure addition/omission of word(s), never a substitution. */
function isSubsetEitherWay(a: Set<string>, b: Set<string>): boolean {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const word of small) {
    if (!big.has(word)) return false;
  }
  return true;
}

/** Last calendar day of a "yyyy-MM" month, as "yyyy-MM-dd". */
function lastDayOfMonth(yyyyMM: string): string {
  const [year, month] = yyyyMM.split("-").map(Number);
  const y = year ?? 1970;
  const m = month ?? 1;
  const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this one
  return `${yyyyMM}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * A sheet row is sometimes logged in both the June and July tabs (carried over verbatim while
 * still relevant) — same underlying video, would otherwise double-count. Dedupes by business
 * unit + normalized title, keeping the first occurrence (tabs are read in config order, so this
 * naturally prefers whichever tab is listed first).
 */
function dedupeRows(rows: DriveCreativeRow[]): DriveCreativeRow[] {
  const seen = new Set<string>();
  const deduped: DriveCreativeRow[] = [];

  for (const row of rows) {
    const key = `${row.businessUnit}::${normalizeTitleForMatching(row.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

/**
 * Finds the live Meta ad matching a sheet row, if any. Joins by exact Meta Ad ID first, then
 * exact normalized-title — confirmed against real data: the sheet can log an ad running in one
 * campaign while the same underlying video is *also* running, as a duplicate with a different Ad
 * ID and a "– Copy" suffix on the title, in a campaign this dashboard actually tracks. Same video
 * either way.
 *
 * Falls back further to a word-subset match when even that fails — confirmed real case: a
 * pod/tracking code (e.g. "KGAT") sometimes gets appended to the ad title on Meta *after* the
 * sheet row was already logged, same underlying video either way. Only matches when one title's
 * words are a strict subset of the other's (a pure addition, never a substitution) AND exactly
 * one live ad satisfies that — this is what keeps it from confusing near-duplicate concepts that
 * differ by a swapped word (e.g. "...front main" vs "...side main" both stay unmatched here,
 * correctly, since neither is a subset of the other).
 *
 * `claimedAdIds` prevents two different sheet rows from both matching the same live ad (e.g. if
 * dedupeRows missed a near-duplicate title) — first row to claim an ad id wins, everything after
 * is left unmatched rather than double-counted as "live" under two different rows.
 */
function matchMetaAd(row: DriveCreativeRow, metaIndex: MetaAdsIndex, claimedAdIds: Set<string>): MetaAdRecord | undefined {
  const candidate =
    (row.metaAdId ? metaIndex.byAdId.get(row.metaAdId) : undefined) ??
    metaIndex.byNormalizedTitle.get(normalizeTitleForMatching(row.name)) ??
    (() => {
      const rowWords = titleWordSet(row.name);
      const matches = metaIndex.all.filter((rec) => isSubsetEitherWay(titleWordSet(rec.adName), rowWords));
      const uniqueIds = new Set(matches.map((rec) => rec.id));
      return uniqueIds.size === 1 ? matches[0] : undefined;
    })();

  if (!candidate || claimedAdIds.has(candidate.id)) return undefined;
  claimedAdIds.add(candidate.id);
  return candidate;
}

/**
 * Builds every video from the "<Business> AI Creatives" sheets (the primary source — see
 * types.ts's PublishedVideo doc comment) and enriches each with live Meta data when a match is
 * found. Best-effort on both sides: a sheet-fetch failure here throws (no primary data at all
 * means nothing to build), but a Meta-match/duration failure for an individual row just leaves
 * that row not-live/without duration rather than failing the whole sync.
 */
async function buildVideosFromSheets(metaIndex: MetaAdsIndex): Promise<PublishedVideo[]> {
  const rawRows = await fetchDriveCreativeRows();
  const rows = dedupeRows(rawRows);

  const allLinks = new Set(rows.map((row) => row.driveLink).filter(Boolean));
  const durationsByLink = isGoogleDriveConfigured() ? await fetchDurationsForDriveLinks(Array.from(allLinks)) : new Map<string, number>();

  const claimedAdIds = new Set<string>();

  return rows.map((row) => {
    const matched = matchMetaAd(row, metaIndex, claimedAdIds);

    const rawEditorName = row.editorName || parseEditorFromAdTitle(row.name);
    const editorName = normalizeEditorName(rawEditorName, config.editorRoster) ?? matchEditorBySegmentScan(row.name, config.editorRoster);
    const videoKind = parseVideoKindFromAdTitle(row.name) ?? matchVideoKindByCutMention(row.name);
    const durationSeconds = row.driveLink ? durationsByLink.get(row.driveLink) ?? null : null;
    const sheetCreatedDate = row.dateMade || (row.sourceMonth ? `${row.sourceMonth}-01` : "");

    if (matched) {
      // Month-boundary correction: a video scripted last month that happens to go live on Meta
      // in the first few hours of this month shouldn't count toward this month — the sheet tab
      // it's logged under is ground truth for when it was actually made. Scoped to day-1 to
      // avoid reclassifying ads that are legitimately from a different month for other reasons.
      // Only affects createdDate (used for filtering/aggregation) — publishedDate below always
      // keeps Meta's raw value, since that column answers "when did this actually go live", not
      // "which month should this count toward".
      let createdDate = matched.createdDate;
      const day = createdDate.slice(8, 10);
      if (day === "01" && row.sourceMonth && row.sourceMonth < createdDate.slice(0, 7)) {
        createdDate = lastDayOfMonth(row.sourceMonth);
      }

      const video: PublishedVideo = {
        id: matched.id,
        accountId: matched.accountId,
        businessUnit: row.businessUnit,
        campaignName: matched.campaignName,
        adName: matched.adName,
        editorName,
        videoKind,
        createdDate,
        sheetCreatedDate,
        publishedDate: matched.createdDate,
        effectiveStatus: matched.effectiveStatus,
        takenLive: true,
        spend: matched.spend,
        impressions: matched.impressions,
        ctr: matched.ctr,
        cpm: matched.cpm,
        cpc: matched.cpc,
        conversions: matched.conversions,
        cpa: matched.cpa,
        durationSeconds,
        isWinning: false,
        winningSource: null,
      };
      return video;
    }

    const video: PublishedVideo = {
      id: `sheet:${row.businessUnit}:${normalizeTitleForMatching(row.name)}`,
      accountId: null,
      businessUnit: row.businessUnit,
      campaignName: "",
      adName: row.name,
      editorName,
      videoKind,
      createdDate: sheetCreatedDate,
      sheetCreatedDate,
      publishedDate: null,
      effectiveStatus: "Not Live",
      takenLive: false,
      spend: 0,
      impressions: 0,
      ctr: 0,
      cpm: 0,
      cpc: 0,
      conversions: null,
      cpa: null,
      durationSeconds,
      isWinning: false,
      winningSource: null,
    };
    return video;
  });
}

/** Re-applies the winning-creative rule + manual overrides over whatever videos are currently stored. */
export async function recomputeWinningFlags(): Promise<void> {
  const [videos, overrides] = await Promise.all([
    publishedVideoRepository.getAll(),
    publishedVideoRepository.getManualOverrides(),
  ]);

  const flagged = applyWinningRule(videos, config.winningRule, overrides, config.winningRuleOverrides);
  await publishedVideoRepository.replaceAll(flagged);
}

/**
 * Pulls fresh data from Google Sheets (progress + AI Creatives) and Meta Ads, independently — a
 * failure in one source doesn't block the others from refreshing. Lumina credits are
 * intentionally untouched here; they only update via CSV upload.
 */
export async function runSync(): Promise<SyncStatus> {
  const [progressResult, metaIndexResult] = await Promise.allSettled([fetchProgressTracker(), fetchMetaAdsIndex()]);

  const fetchedAt = new Date().toISOString();

  if (progressResult.status === "fulfilled") {
    await progressRepository.replaceAll(progressResult.value);
    store.syncStatus.sources.googleSheetsProgress = { ok: true, fetchedAt };
  } else {
    store.syncStatus.sources.googleSheetsProgress = {
      ok: false,
      fetchedAt: store.syncStatus.sources.googleSheetsProgress.fetchedAt,
      message: progressResult.reason instanceof Error ? progressResult.reason.message : String(progressResult.reason),
    };
  }

  // Meta is an enrichment source now — if it fails, videos still get built from the sheets alone
  // (just all not-live), rather than losing the whole sync.
  const metaIndex: MetaAdsIndex =
    metaIndexResult.status === "fulfilled" ? metaIndexResult.value : { byAdId: new Map(), byNormalizedTitle: new Map(), all: [] };

  try {
    const videos = await buildVideosFromSheets(metaIndex);
    await publishedVideoRepository.replaceAll(videos);
    store.syncStatus.sources.metaAds =
      metaIndexResult.status === "fulfilled"
        ? { ok: true, fetchedAt }
        : {
            ok: false,
            fetchedAt: store.syncStatus.sources.metaAds.fetchedAt,
            message:
              metaIndexResult.reason instanceof Error ? metaIndexResult.reason.message : String(metaIndexResult.reason),
          };
  } catch (err) {
    // The sheets themselves are the primary source — a failure here means no video data at all
    // to build from, so leave whatever was already stored untouched rather than wiping it.
    store.syncStatus.sources.metaAds = {
      ok: false,
      fetchedAt: store.syncStatus.sources.metaAds.fetchedAt,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // The winning rule (and any manual overrides) apply regardless of which source just refreshed.
  await recomputeWinningFlags();

  store.syncStatus.lastSyncedAt = fetchedAt;
  return store.syncStatus;
}

export function getSyncStatus(): SyncStatus {
  return store.syncStatus;
}
