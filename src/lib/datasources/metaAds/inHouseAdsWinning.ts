import { config } from "../../config";
import { normalizeTitleForMatching } from "../googleSheets/driveCreatives";
import { metaGraphGetAllPages } from "./client";

interface MetaAdIdentity {
  id: string;
  name: string;
}

/**
 * Per-region lookup for the In House Ads Copy Writer group's own winning check (see
 * config.inHouseAdsWinningRule's doc comment) — keyed by the same region labels
 * cohortForRegion (inHouseAds.ts) produces ("Astrotalk"/"Lumus").
 */
export interface InHouseAdsWinningIndex {
  // Every normalized title seen in EITHER the testing or scaling campaigns — "this concept has
  // actually been put in front of Meta at all" (the eligible/matched signal, distinct from
  // "winning"). A title absent here was never even tested, not just not-yet-scaled.
  testedTitles: Record<string, Set<string>>;
  // Normalized titles found specifically in the scaling account/campaigns — the winning signal.
  winningTitles: Record<string, Set<string>>;
}

const AD_FIELDS = "id,name";

/** Ad identity only (id + name) — no insights, no creative/duration hops. This index only ever
 * needs to answer "does a duplicate of this title exist here", nothing else. */
async function fetchAdIdentities(accountId: string, campaignIds: string[]): Promise<MetaAdIdentity[]> {
  if (campaignIds.length === 0) return [];

  return metaGraphGetAllPages<MetaAdIdentity>(`act_${accountId}/ads`, {
    fields: AD_FIELDS,
    limit: "200",
    filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }]),
  });
}

/**
 * Fetches just enough Meta ad identity from the In House Ads winning rule's own testing/scaling
 * accounts+campaigns (config.inHouseAdsWinningRule) to answer the Copy Writer tab's "In House
 * Ads" winning check — entirely separate from, and much lighter than, the main
 * fetchMetaAdsIndex/metaAds.adAccountIds (those never see these accounts at all; this feature is
 * Copy Writer tab-only, not wired into the Performance tab or main Meta sync per the original
 * decision).
 *
 * Astrotalk's testing and scaling campaigns live in two DIFFERENT ad accounts (confirmed via the
 * Graph API directly: the exact same ad title, unmodified, duplicated straight across accounts —
 * e.g. "comeback_freechat_at - 07 {ankit samridhi}" appears in both); Lumus uses one account for
 * both. Either way, matching is by normalized title only (same normalizeTitleForMatching as
 * everywhere else), never by account — confirmed real duplicates in the scaling side carry
 * stacked "– Copy 2 – Copy" suffixes on top of the testing side's own single "– Copy", which is
 * exactly the case normalizeTitleForMatching's loop (see its own doc comment) was fixed to strip
 * down to the same base title.
 */
export async function fetchInHouseAdsWinningIndex(): Promise<InHouseAdsWinningIndex> {
  const testedTitles: Record<string, Set<string>> = {};
  const winningTitles: Record<string, Set<string>> = {};

  for (const [region, rule] of Object.entries(config.inHouseAdsWinningRule)) {
    const tested = new Set<string>();
    const winning = new Set<string>();

    const [testingAds, scalingAds] = await Promise.all([
      fetchAdIdentities(rule.testingAccountId, rule.testingCampaignIds),
      fetchAdIdentities(rule.scalingAccountId, rule.scalingCampaignIds),
    ]);

    for (const ad of testingAds) tested.add(normalizeTitleForMatching(ad.name));
    for (const ad of scalingAds) {
      const key = normalizeTitleForMatching(ad.name);
      tested.add(key);
      winning.add(key);
    }

    testedTitles[region] = tested;
    winningTitles[region] = winning;
  }

  return { testedTitles, winningTitles };
}
