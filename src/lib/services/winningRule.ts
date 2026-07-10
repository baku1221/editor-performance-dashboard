import type { PublishedVideo, WinningRuleConfig } from "../types";

function getMetricValue(video: PublishedVideo, metric: WinningRuleConfig["metric"]): number | null {
  switch (metric) {
    case "spend":
      return video.spend;
    case "cpi":
    case "cpa":
      return video.cpa;
    case "ctr":
      return video.ctr;
    case "cpc":
      return video.cpc;
    case "cpm":
      return video.cpm;
  }
}

function compare(value: number, operator: WinningRuleConfig["operator"], threshold: number): boolean {
  switch (operator) {
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
  }
}

/**
 * Applies the configurable "Winning Creative" rule (see WINNING_RULE_* in
 * .env.local), then lets any manual override win over the automatic result.
 * Swapping the rule (e.g. to top-N-by-spend) means changing config/this
 * function only — nothing upstream or downstream needs to know.
 *
 * `ruleOverridesByBusinessUnit` swaps the rule entirely for specific business units whose
 * economics don't fit the global one — e.g. Astrotalk Store is a Purchase-objective account
 * where "Winning" means spend crossing a threshold, not CPI/CPA like the app-install accounts.
 */
export function applyWinningRule(
  videos: PublishedVideo[],
  rule: WinningRuleConfig,
  manualOverrides: Map<string, boolean>,
  ruleOverridesByBusinessUnit: Record<string, WinningRuleConfig> = {}
): PublishedVideo[] {
  return videos.map((video) => {
    if (manualOverrides.has(video.id)) {
      return { ...video, isWinning: manualOverrides.get(video.id) ?? false, winningSource: "manual" };
    }

    const effectiveRule = ruleOverridesByBusinessUnit[video.businessUnit] ?? rule;
    const value = getMetricValue(video, effectiveRule.metric);
    const isWinning = value !== null && compare(value, effectiveRule.operator, effectiveRule.value);

    return { ...video, isWinning, winningSource: isWinning ? "rule" : null };
  });
}
