import type {
  DashboardFilters,
  EditorDetail,
  EditorPerformanceRow,
  PerformanceData,
  PerformanceSummary,
  PublishedVideo,
} from "../types";
import { config } from "../config";
import { publishedVideoRepository } from "../repositories/publishedVideoRepository";
import { dateWithinFilters, editorMatchesFilter } from "../filters";

const UNMAPPED_LABEL = "Unmapped";
const ACTIVE_STATUSES = new Set(["ACTIVE"]);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
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
  const winningCreatives = videos.filter((v) => v.isWinning).length;
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
    winningPercent: videos.length > 0 ? round1((winningCreatives / videos.length) * 100) : 0,
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
  const winningCreatives = videos.filter((v) => v.isWinning).length;
  const totalMainAds = videos.filter((v) => v.videoKind === "Main").length;

  return {
    totalVideosSubmitted: videos.length,
    totalMainAds,
    winningCreatives,
    winningPercent: videos.length > 0 ? round1((winningCreatives / videos.length) * 100) : 0,
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

  return { businessUnits, rows };
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
