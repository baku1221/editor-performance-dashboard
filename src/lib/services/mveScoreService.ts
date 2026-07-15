import type { EditorPerformanceRow } from "../types";

const WEIGHTS = { mainAds: 0.4, duration: 0.3, winningPercent: 0.3 };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Main Ads count and total duration are raw, unbounded numbers (a "17" or a "5000 seconds" has
 * no inherent 0-100 meaning) — min-max normalized against the SAME cohort of rows being scored,
 * so the top performer on that metric scores 100 and the bottom scores 0, everyone else
 * proportionally between. This makes the MVE score a relative "who's ahead of whom right now"
 * comparison, not an absolute target — same principle as the Slack leaderboard's ranking, and
 * intentional: there's no externally-defined "20 Main Ads = perfect" benchmark to normalize
 * against instead. Winning % is already a natural 0-100 scale (it's a percentage), so it's used
 * as-is rather than re-normalized — rescaling it relative to the cohort would make a 100%
 * winning-rate editor score lower than 100 whenever someone else also hits 100%, which would be
 * a confusing thing for "winning percent" specifically to do.
 */
function minMaxNormalize(value: number, min: number, max: number): number {
  if (max === min) return value > 0 ? 100 : 0;
  return ((value - min) / (max - min)) * 100;
}

/**
 * Adds an `mveScore` (0-100) to every row, normalized against whichever cohort is passed in — a
 * single business unit's rows, or the flat combined "All" list — so switching between the
 * Performance tab's business-unit tabs naturally recomputes the comparison within that scope.
 * "Unmapped" gets `mveScore: null` (kept in the array, not filtered out, so it still renders in
 * the table like every other row) rather than a real score — it's a catch-all bucket for
 * unattributed ads, not an editor to rank, and including it in the min-max cohort would skew
 * everyone else's normalization around a bucket that isn't a real competitor.
 */
export function computeMveScores<T extends EditorPerformanceRow>(rows: T[]): Array<T & { mveScore: number | null }> {
  const eligible = rows.filter((r) => r.editorName !== "Unmapped");

  if (eligible.length === 0) {
    return rows.map((r) => ({ ...r, mveScore: null }));
  }

  const mainAdsCounts = eligible.map((r) => r.mainAdsCount);
  const durations = eligible.map((r) => r.totalDurationSeconds);
  const minMain = Math.min(...mainAdsCounts);
  const maxMain = Math.max(...mainAdsCounts);
  const minDuration = Math.min(...durations);
  const maxDuration = Math.max(...durations);

  return rows.map((r) => {
    if (r.editorName === "Unmapped") return { ...r, mveScore: null };

    const normalizedMainAds = minMaxNormalize(r.mainAdsCount, minMain, maxMain);
    const normalizedDuration = minMaxNormalize(r.totalDurationSeconds, minDuration, maxDuration);
    const mveScore = round1(
      WEIGHTS.mainAds * normalizedMainAds + WEIGHTS.duration * normalizedDuration + WEIGHTS.winningPercent * r.winningPercent
    );

    return { ...r, mveScore };
  });
}
