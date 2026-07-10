import type { SyncStatus } from "../types";
import { store } from "../cache/store";
import { config } from "../config";
import { fetchProgressTracker } from "../datasources/googleSheets/progressTracker";
import { fetchDriveCreativeRows, normalizeTitleForMatching } from "../datasources/googleSheets/driveCreatives";
import { fetchPublishedVideos } from "../datasources/metaAds/videos";
import { fetchDurationsForDriveLinks, isGoogleDriveConfigured } from "../datasources/googleDrive/client";
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

/**
 * Fills in video duration via the "<Business> AI Creatives" sheet's Drive folder links,
 * sidestepping the Meta permission wall on Video.length entirely. Best-effort and silent on
 * failure (missing key, sheet unreachable, folder not shared) — duration is a nice-to-have
 * layered on top of the core sync, not something that should fail it.
 *
 * Joins by exact Meta Ad ID first, then exact normalized-title — confirmed against real data:
 * the sheet can log an ad running in one campaign while the same underlying video is *also*
 * running, as a duplicate with a different Ad ID and a "– Copy" suffix on the title, in a
 * campaign this dashboard actually tracks. Same video either way.
 *
 * Falls back further to a word-subset match when even that fails — confirmed real case: a
 * pod/tracking code (e.g. "KGAT") sometimes gets appended to the ad title on Meta *after* the
 * sheet row was already logged, same underlying video either way. Only matches when one title's
 * words are a strict subset of the other's (a pure addition, never a substitution) AND exactly
 * one sheet row satisfies that — this is what keeps it from confusing near-duplicate concepts
 * that differ by a swapped word (e.g. "...front main" vs "...side main" both stay unmatched
 * here, correctly, since neither is a subset of the other).
 */
async function applyDriveDurations(): Promise<void> {
  if (config.driveCreativeSheets.length === 0 || !isGoogleDriveConfigured()) return;

  try {
    const creativeRows = await fetchDriveCreativeRows();
    if (creativeRows.length === 0) return;

    const driveLinkByAdId = new Map(
      creativeRows.filter((row) => row.metaAdId).map((row) => [row.metaAdId, row.driveLink])
    );
    const driveLinkByTitle = new Map(
      creativeRows.map((row) => [normalizeTitleForMatching(row.name), row.driveLink])
    );
    const rowWordSets = creativeRows.map((row) => ({ words: titleWordSet(row.name), driveLink: row.driveLink }));

    const allLinks = new Set([...creativeRows.map((row) => row.driveLink), ...Object.values(config.manualDriveLinkOverrides)]);
    const durationsByLink = await fetchDurationsForDriveLinks(Array.from(allLinks));

    const videos = await publishedVideoRepository.getAll();
    const updated = videos.map((video) => {
      if (video.durationSeconds !== null) return video; // don't override an already-known duration

      let driveLink =
        config.manualDriveLinkOverrides[video.id] ??
        driveLinkByAdId.get(video.id) ??
        driveLinkByTitle.get(normalizeTitleForMatching(video.adName));

      if (!driveLink) {
        // Ambiguous only if candidate rows disagree on the actual folder — the same ad is
        // sometimes logged in both the July and June tabs with slightly different text but the
        // same Drive link, which shouldn't count as a conflict.
        const videoWords = titleWordSet(video.adName);
        const candidateLinks = new Set(
          rowWordSets.filter((row) => isSubsetEitherWay(row.words, videoWords)).map((row) => row.driveLink)
        );
        if (candidateLinks.size === 1) driveLink = candidateLinks.values().next().value;
      }

      const duration = driveLink ? durationsByLink.get(driveLink) : undefined;
      return duration !== undefined ? { ...video, durationSeconds: duration } : video;
    });

    await publishedVideoRepository.replaceAll(updated);
  } catch (err) {
    console.error("[applyDriveDurations] Duration lookup failed for this sync — durations left as-is:", err);
  }
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
 * Pulls fresh data from both Google Sheets (progress) and Meta Ads
 * (published videos), independently — a failure in one source doesn't block
 * the other from refreshing. Lumina credits are intentionally untouched
 * here; they only update via CSV upload.
 */
export async function runSync(): Promise<SyncStatus> {
  const [progressResult, videosResult] = await Promise.allSettled([fetchProgressTracker(), fetchPublishedVideos()]);

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

  if (videosResult.status === "fulfilled") {
    await publishedVideoRepository.replaceAll(videosResult.value);
    store.syncStatus.sources.metaAds = { ok: true, fetchedAt };
  } else {
    store.syncStatus.sources.metaAds = {
      ok: false,
      fetchedAt: store.syncStatus.sources.metaAds.fetchedAt,
      message: videosResult.reason instanceof Error ? videosResult.reason.message : String(videosResult.reason),
    };
  }

  // Enrich with duration from the Drive-link sheet before applying the winning rule — CPI-based
  // rules don't need duration, but keeping this ahead of it means any future duration-based rule
  // sees complete data.
  await applyDriveDurations();

  // The winning rule (and any manual overrides) apply regardless of which source just refreshed.
  await recomputeWinningFlags();

  store.syncStatus.lastSyncedAt = fetchedAt;
  return store.syncStatus;
}

export function getSyncStatus(): SyncStatus {
  return store.syncStatus;
}
