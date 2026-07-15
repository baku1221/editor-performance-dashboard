import { publishedVideoRepository } from "../repositories/publishedVideoRepository";
import { config } from "../config";
import { getTimezoneNow, getTimezoneMonthStart } from "../timezone";

export interface LeaderboardEntry {
  editorName: string;
  mainAdsCount: number;
}

/**
 * Ranks editors by Main-ad count within [from, to] inclusive, combined across every business
 * unit — unlike performanceService's per-business-unit rows, a company-wide daily leaderboard
 * should credit an editor's total output regardless of which account it ran under. Cuts are
 * excluded for the same reason buildRow's totalDurationSeconds excludes them elsewhere: a Cut is
 * a re-edit of a Main the editor is already credited for, not separate work.
 */
export async function getTopEditorsByMainAds(from: string, to: string, topN: number): Promise<LeaderboardEntry[]> {
  const videos = await publishedVideoRepository.getAll();
  const counts = new Map<string, number>();

  for (const v of videos) {
    if (v.videoKind !== "Main") continue;
    if (v.editorName === null) continue;
    if (v.createdDate < from || v.createdDate > to) continue;
    counts.set(v.editorName, (counts.get(v.editorName) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([editorName, mainAdsCount]) => ({ editorName, mainAdsCount }))
    .sort((a, b) => b.mainAdsCount - a.mainAdsCount)
    .slice(0, topN);
}

export interface DailyLeaderboards {
  date: string; // "yyyy-MM-dd", IST calendar date this snapshot represents
  today: LeaderboardEntry[];
  month: LeaderboardEntry[];
}

/** Both leaderboards the Slack message + image need, computed once per send to stay consistent. */
export async function getDailyLeaderboards(topN = 5): Promise<DailyLeaderboards> {
  const { date } = getTimezoneNow(config.slack.leaderboardTimezone);
  const monthStart = getTimezoneMonthStart(config.slack.leaderboardTimezone);

  const [today, month] = await Promise.all([
    getTopEditorsByMainAds(date, date, topN),
    getTopEditorsByMainAds(monthStart, date, topN),
  ]);

  return { date, today, month };
}
