import type { EditorPerformanceRow } from "../types";
import { config } from "../config";
import { getPerformanceData } from "./performanceService";
import { computeMveScores } from "./mveScoreService";

// Astrotalk (Foreign) and Lumus show Main Ads specifically in the monthly report's totals line
// (the unique-creative count, not inflated by Cuts) — Astrotalk Store keeps the raw Main+Cut
// total, per explicit request.
const MAIN_ADS_ONLY_UNITS = new Set(["Astrotalk", "Lumus"]);

export interface MonthlyReportEntry {
  editorName: string;
  value: number;
  // Only populated on topByWinningPercent — the Slack message shows it in brackets alongside the
  // percentage (e.g. "45% (10 Main Ads)"), since a percentage alone hides how small the sample
  // behind it might be.
  mainAdsCount?: number;
}

// Excluded from every monthly-report ranking — not real competing video editors this report
// should compare against each other: Abhi is a static-image designer, and Abhay only ever
// contributed a single video this period (too small a sample for a percentage/score to mean
// anything next to editors with dozens of ads).
const EXCLUDED_EDITOR_NAMES = new Set(["Abhi", "Abhay"]);

export interface MonthlyReport {
  monthStart: string; // "yyyy-MM-01"
  monthEnd: string; // the last day of the month, "yyyy-MM-dd"
  // Astrotalk/Lumus/Astrotalk Store totals for the month — Main Ads count for Astrotalk/Lumus
  // (see MAIN_ADS_ONLY_UNITS), raw Main+Cut total videos for Astrotalk Store.
  businessUnitTotals: Record<string, number>;
  topByMve: MonthlyReportEntry[];
  topByWinningPercent: MonthlyReportEntry[];
  topByMainAds: MonthlyReportEntry[];
  topByDuration: MonthlyReportEntry[];
  bottomByMve: MonthlyReportEntry[];
}

const ALL_UNIT = "All";

/** Same combining logic as PerformanceTab.tsx's own local copy (duplicated here rather than
 * imported — that file is a client component, this needs to run server-side in the scheduler). */
function combineRowsByEditor(rows: EditorPerformanceRow[]): EditorPerformanceRow[] {
  const byEditor = new Map<string, EditorPerformanceRow>();

  for (const row of rows) {
    const existing = byEditor.get(row.editorName);
    if (!existing) {
      byEditor.set(row.editorName, { ...row, businessUnit: ALL_UNIT });
      continue;
    }
    existing.videosSubmitted += row.videosSubmitted;
    existing.mainAdsCount += row.mainAdsCount;
    existing.winningCreatives += row.winningCreatives;
    existing.activeCreatives += row.activeCreatives;
    existing.totalDurationSeconds += row.totalDurationSeconds;
  }

  return Array.from(byEditor.values()).map((row) => ({
    ...row,
    winningPercent: row.mainAdsCount > 0 ? Math.round((row.winningCreatives / row.mainAdsCount) * 1000) / 10 : 0,
  }));
}

function topN<T extends EditorPerformanceRow>(rows: T[], count: number, value: (row: T) => number): MonthlyReportEntry[] {
  return [...rows]
    .sort((a, b) => value(b) - value(a))
    .slice(0, count)
    .map((r) => ({ editorName: r.editorName, value: value(r) }));
}

function bottomN<T extends EditorPerformanceRow>(rows: T[], count: number, value: (row: T) => number): MonthlyReportEntry[] {
  return [...rows]
    .sort((a, b) => value(a) - value(b))
    .slice(0, count)
    .map((r) => ({ editorName: r.editorName, value: value(r) }));
}

/**
 * The end-of-month Slack report's data — everyone combined across business units except
 * config.excludedFromAllView (same cohort the Performance tab's "All" view and the daily
 * leaderboard's "This Month" ranking already use), so a top/bottom-5 spot means the same thing
 * here as it does everywhere else in the dashboard. "Unmapped" is dropped — a catch-all bucket
 * for unattributed ads, not a real editor to rank or call out.
 */
export async function getMonthlyReport(monthStart: string, monthEnd: string, topCount = 5): Promise<MonthlyReport> {
  const data = await getPerformanceData({ dateRange: { from: monthStart, to: monthEnd } });

  const businessUnitTotals: Record<string, number> = {};
  for (const bu of data.businessUnits) {
    businessUnitTotals[bu.businessUnit] = MAIN_ADS_ONLY_UNITS.has(bu.businessUnit)
      ? bu.summary.totalMainAds
      : bu.summary.totalVideosSubmitted;
  }

  const excluded = new Set(config.excludedFromAllView);
  const eligibleRows = data.rows.filter(
    (r) => !excluded.has(r.businessUnit) && r.editorName !== "Unmapped" && !EXCLUDED_EDITOR_NAMES.has(r.editorName)
  );
  const combined = combineRowsByEditor(eligibleRows);
  const scored = computeMveScores(combined).filter((r): r is EditorPerformanceRow & { mveScore: number } => r.mveScore !== null);

  const topByWinningPercent = [...scored]
    .sort((a, b) => b.winningPercent - a.winningPercent)
    .slice(0, topCount)
    .map((r) => ({ editorName: r.editorName, value: r.winningPercent, mainAdsCount: r.mainAdsCount }));

  return {
    monthStart,
    monthEnd,
    businessUnitTotals,
    topByMve: topN(scored, topCount, (r) => r.mveScore),
    topByWinningPercent,
    topByMainAds: topN(scored, topCount, (r) => r.mainAdsCount),
    topByDuration: topN(scored, topCount, (r) => r.totalDurationSeconds),
    bottomByMve: bottomN(scored, topCount, (r) => r.mveScore),
  };
}
