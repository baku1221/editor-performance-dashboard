import type { PublishedVideo, WinningNamePatternRule, WinningRuleConfig } from "../types";

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
 *
 * `namePatternOverridesByBusinessUnit` is checked FIRST, ahead of the metric-based rule/override —
 * for a business unit like Pandit Ji, "Winning" isn't a metric threshold at all, it's an ad-name
 * naming convention (see WinningNamePatternRule's doc comment in types.ts).
 *
 * `campaignIdOverridesByBusinessUnit` is a second, independent signal ORed on top of whichever
 * rule above applies — an ad simply being present in one of the listed campaign IDs is itself
 * enough to be "Winning", regardless of ad name or metric. Used for Lumus/Astrotalk's "graduated
 * from testing to scaling" signal: once an ad gets promoted into a scaling campaign, that
 * promotion IS the winning signal, on top of (not instead of) the ✅ ad-name marker.
 */
export function applyWinningRule(
  videos: PublishedVideo[],
  rule: WinningRuleConfig,
  manualOverrides: Map<string, boolean>,
  ruleOverridesByBusinessUnit: Record<string, WinningRuleConfig> = {},
  namePatternOverridesByBusinessUnit: Record<string, WinningNamePatternRule> = {},
  campaignIdOverridesByBusinessUnit: Record<string, string[]> = {}
): PublishedVideo[] {
  return videos.map((video) => {
    if (manualOverrides.has(video.id)) {
      return { ...video, isWinning: manualOverrides.get(video.id) ?? false, winningSource: "manual" };
    }

    const scalingCampaignIds = campaignIdOverridesByBusinessUnit[video.businessUnit];
    const isInScalingCampaign = Boolean(video.campaignId && scalingCampaignIds?.includes(video.campaignId));

    const namePattern = namePatternOverridesByBusinessUnit[video.businessUnit];
    if (namePattern) {
      const adNameLower = video.adName.toLowerCase();
      const includesMatches = !namePattern.adNameIncludes || adNameLower.includes(namePattern.adNameIncludes.toLowerCase());
      const startsWithMatches = !namePattern.adNameStartsWith || video.adName.trim().startsWith(namePattern.adNameStartsWith);
      const campaignMatches =
        !namePattern.campaignNameIncludes || video.campaignName.toLowerCase().includes(namePattern.campaignNameIncludes.toLowerCase());
      const isWinning = (includesMatches && startsWithMatches && campaignMatches) || isInScalingCampaign;
      return { ...video, isWinning, winningSource: isWinning ? "rule" : null };
    }

    if (isInScalingCampaign) {
      return { ...video, isWinning: true, winningSource: "rule" };
    }

    const effectiveRule = ruleOverridesByBusinessUnit[video.businessUnit] ?? rule;
    const value = getMetricValue(video, effectiveRule.metric);
    const isWinning = value !== null && compare(value, effectiveRule.operator, effectiveRule.value);

    return { ...video, isWinning, winningSource: isWinning ? "rule" : null };
  });
}
