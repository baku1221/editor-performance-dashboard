import { config } from "../../config";
import { normalizeToIsoDate } from "../../dates";
import { normalizeTitleForMatching } from "../googleSheets/driveCreatives";
import { metaGraphGetAllPages } from "./client";

interface MetaAdIdentity {
  id: string;
  name: string;
  created_time: string;
}

/**
 * Per-region lookup for the In House Ads Copy Writer group's own winning check (see
 * config.inHouseAdsWinningRule's doc comment) — keyed by the same region labels
 * cohortForRegion (inHouseAds.ts) produces ("Astrotalk"/"Lumus").
 */
export interface InHouseAdsWinningIndex {
  // Normalized titles found specifically in the scaling account/campaigns — the winning signal,
  // and the ONLY thing that determines isWinning (see inHouseAds.ts's matchInHouseAdsMeta) — a
  // title absent from testing is deliberately NOT treated as "not eligible", since testing
  // campaigns get pruned/deleted over time on Meta's side and a genuinely-tested, even
  // genuinely-scaled older concept can stop showing up there.
  winningTitles: Record<string, Set<string>>;
  // region -> normalized title -> earliest created_time seen for that title across BOTH the
  // testing and scaling side (a title can have several duplicate ad objects; "when was this
  // concept first put in front of Meta at all" is the earliest of all of them, same principle as
  // the main sync's earliestCreatedByNormalizedTitle). Drives the Copy Writer detail panel's
  // "Tested On" column.
  testedDates: Record<string, Map<string, string>>;
  // region -> normalized title -> earliest created_time seen specifically among the SCALING
  // account/campaign's own ad objects for that title — when it was first promoted, not when it
  // was first tested. Drives the detail panel's "Scaled On" column; absent entirely for a title
  // that's only ever appeared in testing.
  scaledDates: Record<string, Map<string, string>>;
}

// Shared "nothing fetched yet" shape — reused as the default parameter value everywhere this
// index is threaded through (cache/store.ts, progressTracker.ts, inHouseAds.ts) instead of each
// repeating the same four-empty-collections literal.
export const EMPTY_IN_HOUSE_ADS_WINNING_INDEX: InHouseAdsWinningIndex = {
  winningTitles: {},
  testedDates: {},
  scaledDates: {},
};

const AD_FIELDS = "id,name,created_time";

/** Ad identity + created_time only — no insights, no creative/duration hops. This index only
 * ever needs to answer "does a duplicate of this title exist here, and since when". */
async function fetchAdIdentities(accountId: string, campaignIds: string[]): Promise<MetaAdIdentity[]> {
  if (campaignIds.length === 0) return [];

  return metaGraphGetAllPages<MetaAdIdentity>(`act_${accountId}/ads`, {
    fields: AD_FIELDS,
    limit: "200",
    filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }]),
  });
}

function recordEarliest(map: Map<string, string>, key: string, date: string): void {
  if (!date) return;
  const existing = map.get(key);
  if (!existing || date < existing) map.set(key, date);
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
  const winningTitles: Record<string, Set<string>> = {};
  const testedDates: Record<string, Map<string, string>> = {};
  const scaledDates: Record<string, Map<string, string>> = {};

  for (const [region, rule] of Object.entries(config.inHouseAdsWinningRule)) {
    const winning = new Set<string>();
    const testedAt = new Map<string, string>();
    const scaledAt = new Map<string, string>();

    const [testingAds, scalingAds] = await Promise.all([
      fetchAdIdentities(rule.testingAccountId, rule.testingCampaignIds),
      fetchAdIdentities(rule.scalingAccountId, rule.scalingCampaignIds),
    ]);

    for (const ad of testingAds) {
      recordEarliest(testedAt, normalizeTitleForMatching(ad.name), normalizeToIsoDate(ad.created_time));
    }
    for (const ad of scalingAds) {
      const key = normalizeTitleForMatching(ad.name);
      const date = normalizeToIsoDate(ad.created_time);
      winning.add(key);
      recordEarliest(testedAt, key, date);
      recordEarliest(scaledAt, key, date);
    }

    winningTitles[region] = winning;
    testedDates[region] = testedAt;
    scaledDates[region] = scaledAt;
  }

  return { winningTitles, testedDates, scaledDates };
}
