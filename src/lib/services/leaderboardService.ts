import { publishedVideoRepository } from "../repositories/publishedVideoRepository";
import { config } from "../config";
import { getTimezoneNow, getTimezoneMonthStart } from "../timezone";

export interface LeaderboardEntry {
  editorName: string;
  mainAdsCount: number;
}

/**
 * Ranks editors by Main-ad count within [from, to] inclusive, combined across every business
 * unit except config.excludedFromAllView (e.g. a newer ad account tracked in isolation, same
 * exclusion the Performance tab's "All" view applies) — unlike performanceService's
 * per-business-unit rows, a company-wide daily leaderboard should credit an editor's total
 * output regardless of which account it ran under. Cuts are excluded for the same reason
 * buildRow's totalDurationSeconds excludes them elsewhere: a Cut is a re-edit of a Main the
 * editor is already credited for, not separate work.
 */
/** Omit `topN` (or pass undefined) for the full ranked list, no cutoff. */
export async function getTopEditorsByMainAds(from: string, to: string, topN?: number): Promise<LeaderboardEntry[]> {
  const videos = await publishedVideoRepository.getAll();
  const excluded = new Set(config.excludedFromAllView);
  const counts = new Map<string, number>();

  for (const v of videos) {
    if (v.videoKind !== "Main") continue;
    if (v.editorName === null) continue;
    if (excluded.has(v.businessUnit)) continue;
    if (v.createdDate < from || v.createdDate > to) continue;
    counts.set(v.editorName, (counts.get(v.editorName) ?? 0) + 1);
  }

  const ranked = Array.from(counts.entries())
    .map(([editorName, mainAdsCount]) => ({ editorName, mainAdsCount }))
    .sort((a, b) => b.mainAdsCount - a.mainAdsCount);

  return topN === undefined ? ranked : ranked.slice(0, topN);
}

export interface DailyLeaderboards {
  date: string; // "yyyy-MM-dd", IST calendar date this snapshot represents
  today: LeaderboardEntry[]; // every editor who made a Main ad today, not just a top-N cutoff
  month: LeaderboardEntry[]; // top monthTopN by Main ads this month so far
}

/** Both leaderboards the Slack message needs, computed once per send to stay consistent. */
export async function getDailyLeaderboards(monthTopN = 5): Promise<DailyLeaderboards> {
  const { date } = getTimezoneNow(config.slack.leaderboardTimezone);
  const monthStart = getTimezoneMonthStart(config.slack.leaderboardTimezone);

  const [today, month] = await Promise.all([
    getTopEditorsByMainAds(date, date), // full list — everyone who made something today
    getTopEditorsByMainAds(monthStart, date, monthTopN),
  ]);

  return { date, today, month };
}
