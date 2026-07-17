import type { PublishedVideo, SyncStatus } from "../types";
import { store } from "../cache/store";
import { config, type EditorRosterEntry } from "../config";
import { fetchProgressTracker } from "../datasources/googleSheets/progressTracker";
import { fetchDriveCreativeRows, normalizeTitleForMatching, type DriveCreativeRow } from "../datasources/googleSheets/driveCreatives";
import { fetchMetaAdsIndex, type MetaAdRecord, type MetaAdsIndex } from "../datasources/metaAds/videos";
import { fetchVideoFilesForDriveLinks, isGoogleDriveConfigured, type DriveVideoFile } from "../datasources/googleDrive/client";
import {
  parseEditorFromAdTitle,
  parseVideoKindFromAdTitle,
  normalizeEditorName,
  matchEditorBySegmentScan,
  matchVideoKindByCutMention,
} from "../services/editorTitleParser";
import { progressRepository } from "../repositories/progressRepository";
import { publishedVideoRepository } from "../repositories/publishedVideoRepository";
import { editorRosterRepository } from "../repositories/editorRosterRepository";
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

/**
 * Pulls a version number out of a title/filename, e.g. "3 Messages V1" -> 1, "psychic rey 3V
 * rough cut 1.mp4" -> 1 (via "cut 1", checked first since "V1"-style tokens aren't always
 * present or consistent in real filenames), "Psychic Rey 3 Readings V2 Rough.mp4" -> 2.
 */
function extractVersionNumber(text: string): number | null {
  const cutMatch = text.match(/cut\s*(\d+)/i);
  if (cutMatch?.[1]) return Number(cutMatch[1]);
  const vMatch = text.match(/\bv\.?\s*(\d+)\b/i);
  if (vMatch?.[1]) return Number(vMatch[1]);
  return null;
}

/**
 * A Drive folder is sometimes shared across several sheet rows for the same concept — confirmed
 * real case: "3 Messages V1/V2/V3" all point at one folder containing three separate video
 * files, one per variation. Picking the first file found (the old behavior) silently gave every
 * row in that folder the SAME duration. When a folder has more than one video file, matches by
 * comparing each row's own version number (from its title) against each file's version number
 * (from its filename) — only trusted when exactly one file matches, otherwise falls back to the
 * first file found (no worse than the old behavior, and folders with a single video are
 * unaffected either way).
 */
function pickDurationForRow(rowName: string, files: DriveVideoFile[]): number | null {
  if (files.length === 0) return null;
  if (files.length === 1) return files[0]?.durationSeconds ?? null;

  const rowVersion = extractVersionNumber(rowName);
  if (rowVersion !== null) {
    const matches = files.filter((f) => extractVersionNumber(f.name) === rowVersion);
    if (matches.length === 1) return matches[0]?.durationSeconds ?? null;
  }

  return files[0]?.durationSeconds ?? null;
}

/** The first "|"-delimited segment — the concept/hookline name, before the "V# - Stage" and editor/pod/talent segments. */
function conceptSegment(title: string): string {
  return title.split("|")[0]?.trim() ?? "";
}

/** Same Main/Cut resolution used for the final PublishedVideo — factored out so matchMetaAd can compare kinds, not just words. */
function resolveVideoKind(title: string): "Main" | "Cut" {
  return parseVideoKindFromAdTitle(title) ?? matchVideoKindByCutMention(title);
}

/**
 * The middle "|"-delimited segment (e.g. "V1 - Main", "V2 - Cut 1"), lowercased — only present
 * (non-empty) when the title has at least 3 pipe segments, same convention as
 * parseVideoKindFromAdTitle. Specific enough that two unrelated concepts essentially never share
 * one, which is what makes it safe to require an exact match on this alone in matchMetaAd's
 * concept-subset fallback below.
 */
function stageSegment(title: string): string {
  const segments = title.split("|").map((s) => s.trim()).filter(Boolean);
  return segments.length >= 3 ? (segments[1] ?? "").toLowerCase() : "";
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
 * A final fallback handles nomenclature drift specifically in the editor/pod/talent segment —
 * confirmed real case: sheet row "washroom_stall_lumus | V1 - Main | Rohan Boro - SYAT -
 * Ridhima-PPP" vs the live Meta ad "washroom stall | V1 - Main | Rohan Boro - SYAT - Shreya-PPP":
 * the concept segment has an extra "_lumus" suffix (an addition, already caught above) but the
 * talent name is a straight substitution (Ridhima -> Shreya, presumably a reshoot with a
 * different talent) — a substitution never satisfies the whole-title subset check no matter how
 * small, so titles like this fell through as unmatched. Scoped tighter than a blanket
 * title-similarity match to stay safe: only for accounts using the "Concept | V# - Stage |
 * editor/pod/talent" convention (gated on parseVideoKindFromAdTitle succeeding — the Astrotalk
 * Store account's hookline-style titles don't have a real "stage" segment here, so this never
 * fires for them), and requires the *stage* segment (e.g. "v2 - cut 1") to match exactly — that
 * segment is specific enough that two different concepts essentially never collide on it — plus
 * a same-business-unit check and a word-subset match scoped to just the concept segment, entirely
 * ignoring the editor/pod/talent segment where the actual drift happens.
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
      const rowKind = resolveVideoKind(row.name);
      // Scoped to the same business unit AND the same Main/Cut kind — confirmed real bug
      // otherwise: on the Astrotalk Store account, a Cut's title is *exactly* its Main's title
      // plus the word "cut"/"cuts" (e.g. "...PPP" vs "...PPP|cuts"), which makes the Main title a
      // pure word-subset of the Cut's Meta ad title. Without the kind check, this fallback linked
      // the Main sheet row to the CUT's live Meta ad (and vice versa risked the reverse), pulling
      // in the wrong ad's spend/impressions/title — the row would show a "cuts"-labeled ad name
      // while still being classified "Main" (videoKind comes from the sheet row's own title, not
      // the matched Meta ad's).
      const matches = metaIndex.all.filter(
        (rec) =>
          rec.businessUnit === row.businessUnit &&
          resolveVideoKind(rec.adName) === rowKind &&
          isSubsetEitherWay(titleWordSet(rec.adName), rowWords)
      );
      const uniqueIds = new Set(matches.map((rec) => rec.id));
      return uniqueIds.size === 1 ? matches[0] : undefined;
    })() ??
    (() => {
      const rowStage = stageSegment(row.name);
      if (!rowStage || parseVideoKindFromAdTitle(row.name) === null) return undefined;

      const rowConceptWords = titleWordSet(conceptSegment(row.name));
      const matches = metaIndex.all.filter(
        (rec) =>
          rec.businessUnit === row.businessUnit &&
          stageSegment(rec.adName) === rowStage &&
          isSubsetEitherWay(titleWordSet(conceptSegment(rec.adName)), rowConceptWords)
      );
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
async function buildVideosFromSheets(metaIndex: MetaAdsIndex, roster: EditorRosterEntry[]): Promise<PublishedVideo[]> {
  const rawRows = await fetchDriveCreativeRows();
  const rows = dedupeRows(rawRows);

  const allLinks = new Set(rows.map((row) => row.driveLink).filter(Boolean));
  const filesByLink = isGoogleDriveConfigured() ? await fetchVideoFilesForDriveLinks(Array.from(allLinks)) : new Map<string, DriveVideoFile[]>();

  const claimedAdIds = new Set<string>();

  return rows.map((row) => {
    const matched = matchMetaAd(row, metaIndex, claimedAdIds);

    const rawEditorName = row.editorName || parseEditorFromAdTitle(row.name);
    const editorName = normalizeEditorName(rawEditorName, roster) ?? matchEditorBySegmentScan(row.name, roster);
    const videoKind = resolveVideoKind(row.name);
    const durationSeconds = row.driveLink ? pickDurationForRow(row.name, filesByLink.get(row.driveLink) ?? []) : null;
    const sheetCreatedDate = row.dateMade || (row.sourceMonth ? `${row.sourceMonth}-01` : "");

    if (matched) {
      // The same ad concept is frequently duplicated multiple times within the same testing
      // campaign (confirmed real case: two ad objects for the same concept 15 minutes apart) —
      // each duplicate is its own ad object with its own created_time, and matchMetaAd's various
      // stages can land on any one of them. Published Date should read as "when this concept was
      // first created for testing", so it's always the earliest created_time seen across every
      // ad sharing this normalized title, not whichever duplicate happened to get matched.
      const metaCreatedDate = metaIndex.earliestCreatedByNormalizedTitle.get(normalizeTitleForMatching(row.name)) ?? matched.createdDate;

      // Date-range filtering/aggregation reflects when the ad was actually MADE (per the sheet),
      // not when it happened to go live on Meta — confirmed real gap: 97% of live ads across the
      // dashboard have a publish lag between the sheet's dateMade and Meta's created_time (a few
      // hours to over a week in some cases), which meant selecting e.g. "this week" was silently
      // showing ads by publish date instead of the editor's actual work date. sheetCreatedDate is
      // ground truth here; Meta's date is only a fallback for the rare row with no sheet date at
      // all (no per-row date AND a tab name that doesn't parse as a month, e.g. a future sheet
      // that isn't organized by month).
      const createdDate = sheetCreatedDate || metaCreatedDate;

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
        publishedDate: metaCreatedDate,
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
  // Env-configured EDITOR_ROSTER + any editors added via the dashboard's "Add editor" UI —
  // fetched once per sync so a newly-added editor is recognized in both the Progress Tracker
  // sheet and the AI Creatives sheets on the very next sync.
  const roster = await editorRosterRepository.getEffective();

  const [progressResult, metaIndexResult] = await Promise.allSettled([fetchProgressTracker(roster), fetchMetaAdsIndex()]);

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
    metaIndexResult.status === "fulfilled"
      ? metaIndexResult.value
      : { byAdId: new Map(), byNormalizedTitle: new Map(), earliestCreatedByNormalizedTitle: new Map(), all: [] };

  try {
    const videos = await buildVideosFromSheets(metaIndex, roster);
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
