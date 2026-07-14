import { config, isMetaAdsConfigured } from "../../config";
import { normalizeToIsoDate } from "../../dates";
import { normalizeTitleForMatching } from "../googleSheets/driveCreatives";
import { metaGraphGetAllPages, metaGraphGetByIds } from "./client";

interface MetaAction {
  action_type: string;
  value: string;
}

interface MetaAd {
  id: string;
  name: string;
  created_time: string;
  effective_status: string;
  campaign?: { name: string };
  creative?: { id?: string }; // shallow on purpose — see fetchCreativeVideoIds
}

interface MetaAdInsight {
  ad_id: string;
  spend: string;
  impressions: string;
  ctr: string;
  cpm: string;
  cpc: string;
  actions?: MetaAction[];
}

interface MetaCreative {
  object_story_spec?: { video_data?: { video_id?: string } };
  asset_feed_spec?: { videos?: Array<{ video_id?: string }> };
}

interface MetaVideo {
  length?: number; // seconds
}

/**
 * One live Meta ad's identity + metrics — an enrichment record now, not the primary video
 * entity (see types.ts's PublishedVideo doc comment for why: the "<Business> AI Creatives"
 * sheet is primary, Meta is joined on afterward). Deliberately has no editorName/videoKind/
 * isWinning here — those are sheet-driven (or computed downstream) in syncService.ts.
 */
export interface MetaAdRecord {
  id: string;
  accountId: string;
  businessUnit: string;
  campaignName: string;
  adName: string;
  createdDate: string;
  effectiveStatus: string;
  spend: number;
  impressions: number;
  ctr: number;
  cpm: number;
  cpc: number;
  conversions: number | null;
  cpa: number | null;
  durationSeconds: number | null;
}

/** A lookup index over every currently-live Meta ad, for matching sheet rows against them. */
export interface MetaAdsIndex {
  byAdId: Map<string, MetaAdRecord>;
  byNormalizedTitle: Map<string, MetaAdRecord>;
  /**
   * Every configured account/campaign is itself a "testing" campaign (confirmed: all 3 real
   * campaign names contain "testing" — e.g. "USA_Lumus_Android_Install_testing-PPP"). An ad
   * concept is still frequently duplicated multiple times *within* that same testing campaign
   * (confirmed real case: two ad objects both named "...Have you ever been cheated on..." 15
   * minutes apart) — each duplicate is its own ad object with its own created_time. Published
   * Date should read as "when this concept was first created for testing", not whichever
   * duplicate `byNormalizedTitle`'s last-write-wins happens to keep. Keyed the same way as
   * byNormalizedTitle; value is the minimum created_time seen across every ad sharing that key.
   */
  earliestCreatedByNormalizedTitle: Map<string, string>;
  all: MetaAdRecord[];
}

// Deliberately shallow: requesting the nested video_data/asset_feed_spec fields directly on
// the /ads listing causes a persistent, reproducible HTTP 500 partway through pagination on
// accounts with enough ad history (confirmed: one specific ad's creative complexity breaks the
// *entire page* it's on, silently truncating every ad after it — pagination just stops, with no
// error surfaced, so "Total Videos Submitted" quietly undercounts). Fetching creative details
// as a separate batched-by-id call (like fetchVideoDurations below) isolates that risk to just
// the creative/duration lookup instead of losing ads.
const AD_FIELDS = ["id", "name", "created_time", "effective_status", "campaign{name}", "creative{id}"].join(",");
const INSIGHT_FIELDS = ["ad_id", "spend", "impressions", "ctr", "cpm", "cpc", "actions"].join(",");

/**
 * META_CONVERSION_ACTION_TYPES is a PRIORITY ORDER, not a set to sum. Meta
 * reports the same install under multiple action_type labels — e.g.
 * omni_app_install and mobile_app_install are the same underlying installs,
 * just measured/attributed two different ways (confirmed against a real ad:
 * both were "21", and Meta's own cost_per_action_type only carries
 * omni_app_install, matching Ads Manager's displayed "Cost per result"
 * exactly). Summing them silently doubled every conversion count and halved
 * every CPI. Take the first matching type found, never add across types.
 */
function extractConversions(actions: MetaAction[] | undefined): number | null {
  if (!actions || actions.length === 0) return null;

  for (const actionType of config.metaAds.conversionActionTypes) {
    const match = actions.find((a) => a.action_type === actionType);
    const value = match ? Number(match.value || 0) : 0;
    if (value > 0) return value;
  }

  return null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `campaign.id IN [...]` filter, JSON-encoded for the Marketing API's `filtering` param. */
function campaignFilterParam(): Record<string, string> {
  if (config.metaAds.campaignIds.length === 0) return {};
  return { filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: config.metaAds.campaignIds }]) };
}

/** Bounds the insights report window; omitted entirely (falls back to a lifetime window) if unset. */
function insightsDateRangeParam(): Record<string, string> {
  if (!config.metaAds.insightsSinceDate) return { date_preset: "maximum" };
  return { time_range: JSON.stringify({ since: config.metaAds.insightsSinceDate, until: todayIso() }) };
}

/** Single-video creatives put video_id under object_story_spec; dynamic/Advantage+ creatives under asset_feed_spec. */
function extractVideoIdFromCreative(creative: MetaCreative): string | null {
  return creative.object_story_spec?.video_data?.video_id ?? creative.asset_feed_spec?.videos?.[0]?.video_id ?? null;
}

/**
 * Batched, isolated from the ads listing (see AD_FIELDS comment). A failure here — complexity
 * error on one creative, missing permission, whatever — degrades to "no video/duration data"
 * rather than losing ads from the listing itself.
 */
async function fetchCreativesByIds(creativeIds: string[]): Promise<Map<string, MetaCreative>> {
  const uniqueIds = Array.from(new Set(creativeIds));
  if (uniqueIds.length === 0) return new Map();

  try {
    const byId = await metaGraphGetByIds<MetaCreative>(
      uniqueIds,
      "object_story_spec{video_data{video_id}},asset_feed_spec{videos{video_id}}"
    );
    return new Map(Object.entries(byId));
  } catch {
    return new Map();
  }
}

/**
 * Reading Video.length needs a permission separate from ads_read (the token
 * may have ads access but not video-content access). Duration is a nice-to-have
 * on top of the core sync — failing here shouldn't take down videos/spend/etc,
 * so a permission error degrades to "no durations" rather than aborting sync.
 */
async function fetchVideoDurations(videoIds: string[]): Promise<Map<string, number>> {
  const uniqueIds = Array.from(new Set(videoIds));
  if (uniqueIds.length === 0) return new Map();

  try {
    const byId = await metaGraphGetByIds<MetaVideo>(uniqueIds, "length");
    const durations = new Map<string, number>();
    for (const [id, video] of Object.entries(byId)) {
      if (typeof video.length === "number" && video.length > 0) durations.set(id, Math.round(video.length));
    }
    return durations;
  } catch {
    return new Map();
  }
}

/**
 * Fetches every currently-live ad (+ its metrics) across all configured accounts and returns it
 * as a matchable index, keyed by ad id and by normalized title. Ad identity (name, created_time,
 * status) comes from the /ads edge; performance numbers come from a separate lifetime /insights
 * call and are joined by ad_id. Duration is two more hops: ad -> creative id -> creative's
 * video_id -> Video node's `length`.
 *
 * This is an enrichment source now, not the primary video list — see types.ts's PublishedVideo
 * doc comment. syncService.ts iterates the "<Business> AI Creatives" sheet rows as the primary
 * list and looks up a match in this index for each one.
 */
export async function fetchMetaAdsIndex(): Promise<MetaAdsIndex> {
  if (!isMetaAdsConfigured()) {
    throw new Error(
      "Meta Ads API is not configured. Set META_ACCESS_TOKEN and META_AD_ACCOUNT_IDS in .env.local."
    );
  }

  const perAccount: Array<{ accountId: string; ads: MetaAd[]; insights: MetaAdInsight[] }> = [];

  for (const accountId of config.metaAds.adAccountIds) {
    const [ads, insights] = await Promise.all([
      metaGraphGetAllPages<MetaAd>(`${accountId}/ads`, {
        fields: AD_FIELDS,
        limit: "200",
        ...campaignFilterParam(),
      }),
      metaGraphGetAllPages<MetaAdInsight>(`${accountId}/insights`, {
        level: "ad",
        fields: INSIGHT_FIELDS,
        limit: "200",
        ...insightsDateRangeParam(),
        ...campaignFilterParam(),
      }),
    ]);

    // created_time isn't filterable server-side in a way worth relying on — cheaper and more
    // reliable to bound it here, alongside the insights time_range above.
    const boundedAds = config.metaAds.insightsSinceDate
      ? ads.filter((ad) => normalizeToIsoDate(ad.created_time) >= config.metaAds.insightsSinceDate)
      : ads;

    perAccount.push({ accountId, ads: boundedAds, insights });
  }

  const allCreativeIds = perAccount.flatMap(({ ads }) =>
    ads.map((ad) => ad.creative?.id).filter((id): id is string => Boolean(id))
  );
  const creativesById = await fetchCreativesByIds(allCreativeIds);

  const allVideoIds = Array.from(creativesById.values())
    .map(extractVideoIdFromCreative)
    .filter((id): id is string => id !== null);
  const videoDurations = await fetchVideoDurations(allVideoIds);

  const byAdId = new Map<string, MetaAdRecord>();
  const byNormalizedTitle = new Map<string, MetaAdRecord>();
  const earliestCreatedByNormalizedTitle = new Map<string, string>();
  const all: MetaAdRecord[] = [];

  for (const { accountId, ads, insights } of perAccount) {
    const insightsByAdId = new Map(insights.map((i) => [i.ad_id, i]));

    for (const ad of ads) {
      const insight = insightsByAdId.get(ad.id);
      const spend = Number(insight?.spend || 0);
      const conversions = extractConversions(insight?.actions);
      const creative = ad.creative?.id ? creativesById.get(ad.creative.id) : undefined;
      const videoId = creative ? extractVideoIdFromCreative(creative) : null;

      const record: MetaAdRecord = {
        id: ad.id,
        accountId,
        businessUnit: config.metaAds.accountLabels[accountId] ?? accountId,
        campaignName: ad.campaign?.name ?? "",
        adName: ad.name,
        createdDate: config.createdDateOverrides[ad.id] ?? normalizeToIsoDate(ad.created_time),
        effectiveStatus: ad.effective_status,
        spend,
        impressions: Number(insight?.impressions || 0),
        ctr: Number(insight?.ctr || 0),
        cpm: Number(insight?.cpm || 0),
        cpc: Number(insight?.cpc || 0),
        conversions,
        cpa: conversions && conversions > 0 ? spend / conversions : null,
        durationSeconds: videoId ? videoDurations.get(videoId) ?? null : null,
      };

      const key = normalizeTitleForMatching(record.adName);
      byAdId.set(record.id, record);
      byNormalizedTitle.set(key, record);
      const existingEarliest = earliestCreatedByNormalizedTitle.get(key);
      if (!existingEarliest || record.createdDate < existingEarliest) {
        earliestCreatedByNormalizedTitle.set(key, record.createdDate);
      }
      all.push(record);
    }
  }

  return { byAdId, byNormalizedTitle, earliestCreatedByNormalizedTitle, all };
}
