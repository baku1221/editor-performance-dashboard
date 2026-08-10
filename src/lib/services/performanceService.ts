import type {
  DashboardFilters,
  EditorDetail,
  EditorPerformanceRow,
  MainAdRow,
  MainAdsDetail,
  PerformanceData,
  PerformanceSummary,
  ProgressItem,
  PublishedVideo,
} from "../types";
import { config } from "../config";
import { publishedVideoRepository } from "../repositories/publishedVideoRepository";
import { progressRepository } from "../repositories/progressRepository";
import { dateWithinFilters, editorMatchesFilter } from "../filters";
import { normalizeTitleForMatching } from "../datasources/googleSheets/driveCreatives";
import { COHORT_TO_BUSINESS_UNIT, firstSegment } from "./progressService";
import { parseScriptWriterFromAdTitle } from "./editorTitleParser";

const UNMAPPED_LABEL = "Unmapped";
const ACTIVE_STATUSES = new Set(["ACTIVE"]);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The ad's concept (before the first "|") plus its editor — same grouping key a Main and every
 * one of its Cuts share, since they're re-edits of the same underlying video. Also strips a
 * trailing "Cut N" from the concept text itself — confirmed real naming convention: some rows
 * bake the cut number into the concept segment, not just the "V1 - Cut N" stage segment right
 * after it (e.g. "Rain street interview cheating Cut 1 | V1 - Cut 1 | ..." vs its own Main,
 * "Rain street interview cheating | V1 - Main | ..."). Without stripping this, each numbered cut
 * computed as its own distinct "concept", defeating the dedup entirely and letting a single video
 * with several independently-winning cuts count as several winning creatives instead of one —
 * confirmed real case: winningPercent read 150% for an editor whose cuts each cleared the CPI
 * threshold on their own.
 */
export function conceptKey(video: PublishedVideo): string {
  const concept = video.adName.split("|")[0]?.trim() ?? video.adName;
  const normalized = concept
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s*cut\s*\d+\s*$/, "")
    .trim();
  return `${video.editorName ?? ""}::${normalized}`;
}

/**
 * Universal across every business unit — a Main plus its Cuts are the same underlying video, so
 * if any one of them (Main OR a Cut) is winning (whichever rule applies: a name marker, campaign
 * membership, or its own CPI/spend clearing a threshold), that's one winning concept, not one
 * winning creative per marked/qualifying ad object. Confirmed real bug otherwise: a metric-based
 * business unit where a Main AND several of its own Cuts each independently clear the CPI
 * threshold counted every one of them individually against winningPercent's Main-Ads-only
 * denominator, producing a >100% "winning percentage" for that editor — nonsensical regardless of
 * which winning rule produced the raw count.
 */
function countWinningCreatives(videos: PublishedVideo[]): number {
  const winningConceptKeys = new Set(videos.filter((v) => v.isWinning).map(conceptKey));
  return winningConceptKeys.size;
}

/**
 * Filters by date/editor. Unlike a strict editor-name filter, a video with no
 * matched editor is kept when NO editor filter is selected — dropping it
 * would silently undercount "Total Videos Submitted" against what's actually
 * live on Meta. It's excluded once a specific editor is selected, since an
 * unmapped video can't belong to that editor.
 */
function filterVideos(videos: PublishedVideo[], filters: DashboardFilters): PublishedVideo[] {
  return videos.filter((v) => {
    if (!dateWithinFilters(v.createdDate, filters)) return false;
    if (!filters.editorName) return true;
    return v.editorName !== null && editorMatchesFilter(v.editorName, filters);
  });
}

function buildRow(editorName: string, businessUnit: string, videos: PublishedVideo[]): EditorPerformanceRow {
  const winningCreatives = countWinningCreatives(videos);
  const activeCreatives = videos.filter((v) => ACTIVE_STATUSES.has(v.effectiveStatus)).length;
  // Main only, not Cuts — a Cut is a shorter re-edit of the same underlying video the editor
  // already gets credited for via its Main version; summing both would double-count the work.
  const totalDurationSeconds = videos
    .filter((v) => v.videoKind === "Main")
    .reduce((sum, v) => sum + (v.durationSeconds ?? 0), 0);
  const mainAdsCount = videos.filter((v) => v.videoKind === "Main").length;

  return {
    editorName,
    businessUnit,
    videosSubmitted: videos.length,
    mainAdsCount,
    winningCreatives,
    // Main Ads, not raw videosSubmitted (Main+Cut) — a Cut is a re-edit of the same underlying
    // video, not separate work, so it shouldn't dilute the denominator any more than it inflates
    // the numerator (winningCreatives is already deduped to "per concept" for business units
    // that need it — see countWinningCreatives). Universal across every business unit, not just
    // the deduped ones, so the ratio always reads the same way: winners per unique video made.
    winningPercent: mainAdsCount > 0 ? round1((winningCreatives / mainAdsCount) * 100) : 0,
    activeCreatives,
    totalDurationSeconds,
  };
}

/**
 * The configured analysis window (META_INSIGHTS_SINCE_DATE -> today), not the
 * min/max createdDate actually found in the data — those can differ a lot
 * (e.g. if every ad happened to be created in one narrow week), which reads
 * as "the sync window is wrong" when it isn't. "to" is always today's actual
 * date, recomputed fresh on every request.
 */
function getAnalysisWindow(): PerformanceSummary["dateRange"] {
  if (!config.metaAds.insightsSinceDate) return null;
  return { from: config.metaAds.insightsSinceDate, to: new Date().toISOString().slice(0, 10) };
}

function buildSummary(videos: PublishedVideo[], rows: EditorPerformanceRow[]): PerformanceSummary {
  const winningCreatives = countWinningCreatives(videos);
  const totalMainAds = videos.filter((v) => v.videoKind === "Main").length;

  return {
    totalVideosSubmitted: videos.length,
    totalMainAds,
    winningCreatives,
    winningPercent: totalMainAds > 0 ? round1((winningCreatives / totalMainAds) * 100) : 0,
    totalEditors: rows.filter((r) => r.editorName !== UNMAPPED_LABEL).length,
    dateRange: getAnalysisWindow(),
  };
}

/**
 * Rows and summaries are computed per business unit (Lumus / Astrotalk, from
 * PublishedVideo.businessUnit) rather than once overall — the Performance
 * tab's sub-tabs switch between these, mirroring how Daily Progress splits
 * into Foreign/Lumus sections.
 */
export async function getPerformanceData(filters: DashboardFilters): Promise<PerformanceData> {
  const allVideos = await publishedVideoRepository.getAll();
  const filtered = filterVideos(allVideos, filters);

  const businessUnitNames = Array.from(new Set(filtered.map((v) => v.businessUnit))).sort((a, b) =>
    a.localeCompare(b)
  );

  const rows: EditorPerformanceRow[] = [];
  const businessUnits: PerformanceData["businessUnits"] = [];

  for (const businessUnit of businessUnitNames) {
    const unitVideos = filtered.filter((v) => v.businessUnit === businessUnit);

    const byEditor = new Map<string, PublishedVideo[]>();
    const unmapped: PublishedVideo[] = [];

    for (const video of unitVideos) {
      if (video.editorName === null) {
        unmapped.push(video);
        continue;
      }
      const list = byEditor.get(video.editorName) ?? [];
      list.push(video);
      byEditor.set(video.editorName, list);
    }

    const unitRows = Array.from(byEditor.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([editorName, editorVideos]) => buildRow(editorName, businessUnit, editorVideos));

    // Surfaced rather than silently dropped — see filterVideos' comment.
    if (unmapped.length > 0 && !filters.editorName) {
      unitRows.push(buildRow(UNMAPPED_LABEL, businessUnit, unmapped));
    }

    rows.push(...unitRows);
    businessUnits.push({ businessUnit, summary: buildSummary(unitVideos, unitRows) });
  }

  return { businessUnits, rows, excludedFromAllView: config.excludedFromAllView };
}

export async function getEditorDetail(
  editorName: string,
  filters: DashboardFilters,
  businessUnit?: string
): Promise<EditorDetail> {
  const allVideos = await publishedVideoRepository.getAll();
  const filtered = filterVideos(allVideos, { ...filters, editorName: undefined });

  const editorVideos = filtered.filter((v) => {
    const matchesEditor = editorName === UNMAPPED_LABEL ? v.editorName === null : v.editorName === editorName;
    if (!matchesEditor) return false;
    if (businessUnit && v.businessUnit !== businessUnit) return false;
    return true;
  });

  return {
    editorName,
    videos: editorVideos.sort((a, b) => b.createdDate.localeCompare(a.createdDate)),
  };
}

/** The Progress Tracker item this video's script came from — same editor + concept-title match
 * progressService.ts's matchVideo does in the opposite direction (sheet row -> Meta video),
 * reversed here (Meta video -> sheet row) since MainAdRow needs the script writer's name. Falls
 * back to parsing it straight off the ad title's own naming convention (see
 * parseScriptWriterFromAdTitle) when no sheet row matches — confirmed real gap: a video can be
 * live on Meta with no corresponding Progress Tracker row at all (never logged there, or logged
 * under a slightly different concept/editor spelling that fails the exact match above), even
 * though the script writer's name is sitting right there in the ad title. */
function findScriptWriter(video: PublishedVideo, progressItems: ProgressItem[]): string | null {
  const targetConcept = normalizeTitleForMatching(firstSegment(video.adName));
  const match = progressItems.find(
    (item) =>
      COHORT_TO_BUSINESS_UNIT[item.cohort] === video.businessUnit &&
      item.editorName === video.editorName &&
      normalizeTitleForMatching(firstSegment(item.videoName)) === targetConcept
  );
  return match?.scriptWriter ?? parseScriptWriterFromAdTitle(video.adName);
}

/** Every Main-kind ad for one business unit across all editors — the "Total Unique Ads (Main)"
 * summary card's drill-down (see MainAdsDetail's doc comment in types.ts). */
export async function getMainAdsDetail(businessUnit: string, filters: DashboardFilters): Promise<MainAdsDetail> {
  const [allVideos, progressItems] = await Promise.all([publishedVideoRepository.getAll(), progressRepository.getAll()]);
  const unitVideos = filterVideos(allVideos, filters).filter((v) => v.businessUnit === businessUnit);

  // A concept is "Scaled" if ANY of its versions is — the Main shown in this row, or one of its
  // own Cuts — same "any version wins for the whole concept" rule countWinningCreatives already
  // applies to the aggregate winningPercent above. Without this, a Main whose own ad object never
  // got duplicated into the scaling campaign showed "No" here even though one of its Cuts had
  // been — confirmed real case: the Main sat in the testing campaign while its Cut sat in the
  // scaling campaign, same underlying creative, just the Main's own raw isWinning was shown.
  const winningConceptKeys = new Set(unitVideos.filter((v) => v.isWinning).map(conceptKey));

  const videos: MainAdRow[] = unitVideos
    .filter((v) => v.videoKind === "Main")
    .map((v) => ({
      ...v,
      isWinning: winningConceptKeys.has(conceptKey(v)),
      scriptWriter: findScriptWriter(v, progressItems),
    }));

  return {
    businessUnit,
    videos: videos.sort((a, b) => b.createdDate.localeCompare(a.createdDate)),
  };
}

/** Every version (Main + every Cut) of the same underlying video as the given ad id — the Main
 * Ads drill-down's own drill-down, since a Main's CPI is one number but a scaling-campaign
 * promotion can land on any individual Cut (see winningRule.ts). Main sorts first, then Cuts in
 * whatever order they were created. */
export async function getAdVersions(businessUnit: string, adId: string, filters: DashboardFilters): Promise<PublishedVideo[]> {
  const allVideos = await publishedVideoRepository.getAll();
  const filtered = filterVideos(allVideos, filters);

  const target = filtered.find((v) => v.businessUnit === businessUnit && v.id === adId);
  if (!target) return [];

  const targetKey = conceptKey(target);
  return filtered
    .filter((v) => v.businessUnit === businessUnit && conceptKey(v) === targetKey)
    .sort((a, b) => {
      if (a.videoKind === b.videoKind) return a.createdDate.localeCompare(b.createdDate);
      if (a.videoKind === "Main") return -1;
      if (b.videoKind === "Main") return 1;
      return 0;
    });
}
