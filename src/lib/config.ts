import type { WinningNamePatternRule, WinningRuleConfig, WinningRuleMetric, WinningRuleOperator } from "./types";

function csv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export interface ProgressTrackerTab {
  name: string; // exact tab name as it appears on the sheet
  cohort: string; // human label shown in the UI, e.g. "Foreign" | "Lumus"
}

// Override via PROGRESS_TRACKER_TABS="Exact Tab Name|Cohort Label,Other Tab|Other Label"
function parseProgressTrackerTabs(value: string | undefined): ProgressTrackerTab[] {
  const entries = csv(value);
  if (entries.length === 0) return [];

  return entries.map((entry) => {
    const [name, cohort] = entry.split("|").map((s) => s.trim());
    return { name: name ?? entry, cohort: cohort || name || entry };
  });
}

const DEFAULT_PROGRESS_TRACKER_TABS: ProgressTrackerTab[] = [
  { name: "Ad Tracker-foreign(AT)", cohort: "Astrotalk Foreign" },
  { name: "Ad Tracker-foreign(LUMUS)", cohort: "Lumus" },
  // Feeds the Copy Writer tab's India view only — Daily Progress explicitly filters this cohort
  // back out (see /api/progress/route.ts) since India was historically excluded there on purpose.
  { name: "Ad Tracker-India", cohort: "India" },
];

// Override via META_ACCOUNT_LABELS="act_XXX|Label,act_YYY|Other Label"
function parseAccountLabels(value: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of csv(value)) {
    const [id, label] = entry.split("|").map((s) => s.trim());
    if (id) map[id] = label || id;
  }
  return map;
}

const DEFAULT_ACCOUNT_LABELS: Record<string, string> = {
  act_572321625688986: "Lumus",
  act_2021416865462021: "Astrotalk",
  act_2158343221618433: "Astrotalk Store",
  act_872869545439171: "Astrotalk India",
  // Must match the "Pandit Ji" businessUnit used in driveCreativeSheets below — matchMetaAd
  // (syncService.ts) requires a Meta ad's businessUnit to equal the sheet row's businessUnit
  // before its word-subset/stage-segment fallback matches can fire (the exact-Meta-Ad-ID match
  // doesn't need this, but rows logged without one do).
  act_982289496581985: "Pandit Ji",
};

export interface EditorRosterEntry {
  canonical: string; // display name used everywhere in the dashboard
  aliases: string[]; // includes canonical itself — every spelling that should match this editor
}

// Override via EDITOR_ROSTER="Canonical Name|alias1|alias2,Other Name". Aliases exist because
// real ad titles carry spelling drift ("Sutikshan" vs "Sutiskhan") and typos ("partigya" vs
// "Pratigya") — without an alias, each variant would otherwise land in "Unmapped" instead of
// under the real editor.
function parseEditorRoster(value: string | undefined): EditorRosterEntry[] {
  return csv(value).map((entry) => {
    const parts = entry.split("|").map((s) => s.trim()).filter(Boolean);
    const canonical = parts[0] ?? entry;
    return { canonical, aliases: parts.length > 0 ? parts : [entry] };
  });
}

// User policy: an ad only counts toward a given month if it was BOTH scripted AND published live
// in that month. Confirmed real case: a batch of ads scripted in June went live on Meta in the
// first few hours of July 1 IST — genuinely June-origin work (each concept is logged in the
// source sheet's June tab, not July), just published a few hours late across the month
// boundary. Overrides createdDate for the given ad id so date-range filtering (e.g. "This
// month") reflects when the video was actually made, not its technical publish timestamp.
// Format: "metaAdId|yyyy-MM-dd,metaAdId2|yyyy-MM-dd".
function parseCreatedDateOverrides(value: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of csv(value)) {
    const [adId, date] = entry.split("|").map((s) => s.trim());
    if (adId && date) map[adId] = date;
  }
  return map;
}

// Override the global winning rule for specific business units — e.g. Astrotalk Store is a
// Purchase-objective/e-commerce account, so "Winning" there means total spend crossing a
// threshold, not CPI/CPA like the app-install accounts. Format: "Business Unit|metric|operator|value".
function parseWinningRuleOverrides(value: string | undefined): Record<string, WinningRuleConfig> {
  const map: Record<string, WinningRuleConfig> = {};
  for (const entry of csv(value)) {
    const [businessUnit, metric, operator, rawValue] = entry.split("|").map((s) => s.trim());
    if (!businessUnit || !metric || !operator || !rawValue) continue;
    map[businessUnit] = {
      metric: metric as WinningRuleMetric,
      operator: operator as WinningRuleOperator,
      value: Number(rawValue),
    };
  }
  return map;
}

// A second, name-based override mechanism alongside parseWinningRuleOverrides above — for
// business units where "Winning" is identified by a naming CONVENTION (an ad-name marker,
// confined to one specific campaign) rather than a numeric metric threshold. Format:
// "Business Unit|adNamePattern|campaignNameSubstring" (the campaign part is optional — omit it,
// and its trailing "|", to match on ad name alone). adNamePattern is a plain substring by
// default (e.g. "L1C1"); prefix it with "^" (e.g. "^✅") to require the ad name to START with it
// instead — for a literal marker character where position matters, not just presence anywhere.
function parseWinningNamePatternOverrides(value: string | undefined): Record<string, WinningNamePatternRule> {
  const map: Record<string, WinningNamePatternRule> = {};
  for (const entry of csv(value)) {
    const [businessUnit, adNamePattern, campaignNameIncludes] = entry.split("|").map((s) => s.trim());
    if (!businessUnit || !adNamePattern) continue;
    map[businessUnit] = adNamePattern.startsWith("^")
      ? { adNameStartsWith: adNamePattern.slice(1), campaignNameIncludes: campaignNameIncludes || undefined }
      : { adNameIncludes: adNamePattern, campaignNameIncludes: campaignNameIncludes || undefined };
  }
  return map;
}

// A THIRD override mechanism, independent of the two above and ORed on top of whichever one
// applies — "Winning" simply because the ad exists in one of these specific campaign IDs,
// regardless of ad name or metric. Used for Lumus/Astrotalk's "graduated from testing to
// scaling" signal: once the team promotes a winning ad from its testing campaign into a scaling
// campaign, that promotion is itself the signal — same testing-vs-scaling economics
// (WINNING_RULE_OVERRIDES) don't capture a decision made by a human, not a formula. Format:
// "Business Unit|campaignId1|campaignId2,Other Unit|campaignId1".
function parseWinningCampaignIdOverrides(value: string | undefined): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const entry of csv(value)) {
    const parts = entry.split("|").map((s) => s.trim()).filter(Boolean);
    const businessUnit = parts[0];
    const campaignIds = parts.slice(1);
    if (!businessUnit || campaignIds.length === 0) continue;
    map[businessUnit] = campaignIds;
  }
  return map;
}

export const config = {
  googleSheets: {
    // Two supported auth modes: a plain API key (works for link-shared/public sheets, no
    // sharing-with-an-email needed), or a service account (works for restricted sheets).
    // API key wins if both happen to be set.
    apiKey: process.env.GOOGLE_SHEETS_API_KEY ?? "",
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "",
    privateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    progressTracker: {
      sheetId: process.env.PROGRESS_TRACKER_SHEET_ID ?? "",
      // Only the Foreign + Lumus ad tracker tabs feed Daily Progress (India tab is excluded on purpose).
      // Columns are located by header name per tab (see progressTracker.ts), not by fixed position.
      tabs:
        parseProgressTrackerTabs(process.env.PROGRESS_TRACKER_TABS).length > 0
          ? parseProgressTrackerTabs(process.env.PROGRESS_TRACKER_TABS)
          : DEFAULT_PROGRESS_TRACKER_TABS,
    },
  },
  metaAds: {
    accessToken: process.env.META_ACCESS_TOKEN ?? "",
    apiVersion: process.env.META_API_VERSION ?? "v20.0",
    adAccountIds: csv(process.env.META_AD_ACCOUNT_IDS),
    // PRIORITY ORDER, not a set to sum — Meta reports the same install under multiple
    // action_type labels (omni_app_install and mobile_app_install are the same underlying
    // installs, just two attribution methods). The first matching type found wins; see
    // extractConversions in metaAds/videos.ts.
    conversionActionTypes:
      csv(process.env.META_CONVERSION_ACTION_TYPES).length > 0
        ? csv(process.env.META_CONVERSION_ACTION_TYPES)
        : ["omni_app_install", "mobile_app_install", "omni_purchase"],
    // Restrict to specific install campaigns (not the whole account) — keeps the /ads fetch
    // small enough to avoid Meta's "reduce the amount of data" error on accounts with a lot
    // of ad history, and keeps unrelated web/subscription campaigns out of the dashboard.
    // Empty = no restriction (fetch every campaign in the account).
    campaignIds: csv(process.env.META_CAMPAIGN_IDS),
    // Bounds both the ads fetch (by created_time) and the insights time_range. Empty = lifetime.
    insightsSinceDate: process.env.META_INSIGHTS_SINCE_DATE ?? "",
    // Maps a Meta ad account id to a human business-unit label (Performance tab sub-tabs).
    // Falls back to the raw account id for any account not listed here.
    accountLabels:
      Object.keys(parseAccountLabels(process.env.META_ACCOUNT_LABELS)).length > 0
        ? parseAccountLabels(process.env.META_ACCOUNT_LABELS)
        : DEFAULT_ACCOUNT_LABELS,
  },
  // Canonical editor names (+ aliases), once supplied, used to normalize whatever's parsed out
  // of ad titles or read from the Progress Tracker sheet's Editor column.
  editorRoster: parseEditorRoster(process.env.EDITOR_ROSTER),
  // The primary source of "what videos exist" — one sheet per business unit ("Lumus AI
  // Creatives", "Astrotalk AI Creatives", "Astrotalk Store AI Creatives"). Every logged row
  // counts as a video regardless of Meta status; Meta is joined on afterward (by the row's own
  // Meta Ad ID first, then by title — see normalizeTitleForMatching — since the ad id logged in
  // the sheet is often a different campaign's duplicate of the same underlying video, not the
  // exact id this dashboard tracks) purely to enrich with live metrics when available.
  driveCreativeSheets: [
    {
      sheetId: process.env.DRIVE_CREATIVE_SHEET_ID ?? "",
      tabs: csv(process.env.DRIVE_CREATIVE_SHEET_TABS).length > 0 ? csv(process.env.DRIVE_CREATIVE_SHEET_TABS) : ["July 2026"],
      businessUnit: "Lumus",
    },
    {
      sheetId: process.env.DRIVE_CREATIVE_SHEET_ID_2 ?? "",
      tabs: csv(process.env.DRIVE_CREATIVE_SHEET_TABS_2).length > 0 ? csv(process.env.DRIVE_CREATIVE_SHEET_TABS_2) : ["July 2026"],
      businessUnit: "Astrotalk",
    },
    {
      sheetId: process.env.DRIVE_CREATIVE_SHEET_ID_3 ?? "",
      tabs: csv(process.env.DRIVE_CREATIVE_SHEET_TABS_3).length > 0 ? csv(process.env.DRIVE_CREATIVE_SHEET_TABS_3) : ["July 2026"],
      businessUnit: "Astrotalk Store",
    },
    // A second, separate spreadsheet for the same business unit — Astrotalk Store splits its
    // creatives across two sheets ("india"/"native" tabs) rather than one. Multiple sheets can
    // share a businessUnit fine; fetchDriveCreativeRows just reads every configured sheet.
    {
      sheetId: process.env.DRIVE_CREATIVE_SHEET_ID_4 ?? "",
      tabs: csv(process.env.DRIVE_CREATIVE_SHEET_TABS_4).length > 0 ? csv(process.env.DRIVE_CREATIVE_SHEET_TABS_4) : ["india", "native"],
      businessUnit: "Astrotalk Store",
    },
    // Organic social media content (not Meta ads) — same sheet-primary model regardless; Meta
    // enrichment simply never matches anything here since there's no ad account for it, so every
    // row stays "not live" with its own sheet date. Carousel (Canva image) rows are filtered out
    // in fetchDriveCreativeRows, not here — only videos count.
    {
      sheetId: process.env.DRIVE_CREATIVE_SHEET_ID_5 ?? "",
      tabs: csv(process.env.DRIVE_CREATIVE_SHEET_TABS_5).length > 0 ? csv(process.env.DRIVE_CREATIVE_SHEET_TABS_5) : ["July 2026"],
      businessUnit: "Social Media",
    },
    // Separate India-specific Meta ad account (act_872869545439171, "Astrotalk 2026") — kept as
    // its own business unit rather than folded into "Astrotalk" so it can be excluded from the
    // combined "All" view (see excludedFromAllView below) without affecting the original
    // Astrotalk account's numbers. Same "Static"/"AI Static" vs "AI Video" Type column as the
    // original Astrotalk Store sheet — filtered in fetchDriveCreativeRows, not here.
    {
      sheetId: process.env.DRIVE_CREATIVE_SHEET_ID_6 ?? "",
      tabs: csv(process.env.DRIVE_CREATIVE_SHEET_TABS_6).length > 0 ? csv(process.env.DRIVE_CREATIVE_SHEET_TABS_6) : ["July 2026", "June 2026"],
      businessUnit: "Astrotalk India",
    },
    // "Pandit Ji AI Creatives" sheet — a separate app/product ("Pandit Ji AI"), its own business
    // unit. No Meta ad account is configured for it yet (its ads currently run under a Meta ad
    // account this dashboard doesn't fetch), so — same as Social Media above — every row stays
    // sheet-only (no live status/CPI) until one is wired up. Same Type column (Static/AI Static
    // excluded by default) and column layout as the Astrotalk sheet (slot 2), including the
    // Category-then-Date column pair, so no locator changes were needed in driveCreatives.ts.
    {
      sheetId: process.env.DRIVE_CREATIVE_SHEET_ID_7 ?? "",
      tabs: csv(process.env.DRIVE_CREATIVE_SHEET_TABS_7).length > 0 ? csv(process.env.DRIVE_CREATIVE_SHEET_TABS_7) : ["July 2026"],
      businessUnit: "Pandit Ji",
    },
  ].filter((s) => s.sheetId),
  // Business units in this list still get their own selectable Performance-tab, but are left out
  // of the "All" combined view/summary and the Slack leaderboard's cross-unit ranking — see
  // PerformanceTab.tsx's combineRowsByEditor and leaderboardService.ts's getTopEditorsByMainAds.
  // Astrotalk India is a separate, newer Meta ad account being tracked in isolation on purpose;
  // Pandit Ji is a distinct product the team wants tracked separately from the combined view too.
  excludedFromAllView:
    csv(process.env.EXCLUDE_FROM_ALL_VIEW).length > 0 ? csv(process.env.EXCLUDE_FROM_ALL_VIEW) : ["Astrotalk India", "Pandit Ji"],
  // The Copy Writer tab's "Foreign" (Lumus + Astrotalk Foreign) roster — only these names show up
  // there, even if the Progress Tracker sheet's "Script By" column has other values (pod codes,
  // one-off contributors, etc.) mixed in.
  scriptWriterRoster:
    csv(process.env.SCRIPT_WRITER_ROSTER).length > 0
      ? csv(process.env.SCRIPT_WRITER_ROSTER)
      : ["Ridhima", "Shreya", "Samridhi", "Preyensha", "Moksh", "Vanshika", "Riya"],
  // The Copy Writer tab's "India" roster — unlike scriptWriterRoster above, empty by default
  // (no curated list given yet), which means unrestricted: every "Script By" name from the India
  // ad tracker tab shows up. Set SCRIPT_WRITER_ROSTER_INDIA to start restricting it the same way.
  scriptWriterRosterIndia: csv(process.env.SCRIPT_WRITER_ROSTER_INDIA),
  createdDateOverrides: parseCreatedDateOverrides(process.env.CREATED_DATE_MANUAL_OVERRIDES),
  googleDrive: {
    // Needed to read video duration from the Drive folders referenced above — a plain Sheets
    // API key does NOT also grant Drive API access; the Drive API must be separately enabled
    // on the same (or another) Google Cloud project and this key generated there.
    apiKey: process.env.GOOGLE_DRIVE_API_KEY ?? "",
  },
  winningRule: {
    metric: (process.env.WINNING_RULE_METRIC as WinningRuleMetric) ?? "cpi",
    operator: (process.env.WINNING_RULE_OPERATOR as WinningRuleOperator) ?? "lt",
    value: Number(process.env.WINNING_RULE_VALUE ?? 350),
  } satisfies WinningRuleConfig,
  // Per-business-unit overrides of the rule above — see parseWinningRuleOverrides.
  winningRuleOverrides: parseWinningRuleOverrides(process.env.WINNING_RULE_OVERRIDES),
  // Name-pattern overrides — checked BEFORE winningRuleOverrides/winningRule for a business unit
  // that has one (see applyWinningRule in winningRule.ts). Pandit Ji identifies its winning
  // creatives by an "L1C1" ad-name marker, applied only within its "PJ - Install Testing EXC"
  // campaign — confirmed via a sample of that campaign's real ad names, which are consistently
  // prefixed "L1C1 "/"l1C1 " (the sheet's own row lacks this prefix; it's added only once an ad is
  // duplicated into the testing campaign — the same title-matching logic that already handles
  // Meta's "– Copy" suffix duplicates picks these up too, since it's a pure word addition).
  // Lumus and Astrotalk (Foreign) instead mark a winning ad with a "✅" prefix on the ad name
  // itself, confined to their one already-configured "Install" campaign (both accounts' single
  // configured campaign — "USA_Lumus_Android_Install_testing-PPP" and "FOREIGN | PPP | Testing -
  // Install_native_USA_android" — already has "Install" in its name, so no new campaign IDs were
  // needed, unlike Pandit Ji's separate testing campaign). Confirmed via a real ad in that
  // Astrotalk campaign: "✅Temptation island | V1 - cut2 | ..." — note the marker was on a CUT,
  // not that concept's Main, which is exactly the "any version can carry the marker" case
  // performanceService.ts's per-concept dedup (see DEDUPE_WINNING_BY_CONCEPT_BUSINESS_UNITS) and
  // progressService.ts's matchVideo (pre-existing "ANY version — Main or Cut — is winning" join)
  // are both built to handle.
  winningNamePatternOverrides:
    Object.keys(parseWinningNamePatternOverrides(process.env.WINNING_NAME_PATTERN_OVERRIDES)).length > 0
      ? parseWinningNamePatternOverrides(process.env.WINNING_NAME_PATTERN_OVERRIDES)
      : {
          "Pandit Ji": { adNameIncludes: "l1c1", campaignNameIncludes: "testing" },
          Lumus: { adNameStartsWith: "✅", campaignNameIncludes: "install" },
          Astrotalk: { adNameStartsWith: "✅", campaignNameIncludes: "install" },
        },
  // Business units where multiple Cuts of the SAME underlying video shouldn't each count as a
  // separate "winning creative" — the ✅ marker above is applied per-ad-object, and a Cut is just
  // a re-edit of the same concept (sometimes the marker lands on a Cut, not its Main, per the
  // real example above), so counting every marked cut individually would overcount how many
  // distinct concepts actually won. See performanceService.ts's countWinningCreatives. Scoped to
  // just Lumus/Astrotalk (not Pandit Ji, Astrotalk Store, etc.) since this is specifically about
  // the ✅ marker's per-ad-object semantics, not a general policy for every business unit.
  winningDedupeByConceptBusinessUnits:
    csv(process.env.WINNING_DEDUPE_BY_CONCEPT_BUSINESS_UNITS).length > 0
      ? csv(process.env.WINNING_DEDUPE_BY_CONCEPT_BUSINESS_UNITS)
      : ["Lumus", "Astrotalk"],
  // See parseWinningCampaignIdOverrides. Lumus's two scaling campaigns ("USA_lumus_android_
  // Scaling PPP CBO_Start_Journey" and "USA_Lumus_APP_iOS_PPP_StartJourney") + Astrotalk's one
  // ("Native_Foreign | PPP | Purchase - Android CBO (Just for testing) – Start Journey_native_
  // USA") — these campaign IDs must also be added to META_CAMPAIGN_IDS or their ads never get
  // fetched at all, so this check would never have anything to match against.
  winningCampaignIdOverrides:
    Object.keys(parseWinningCampaignIdOverrides(process.env.WINNING_CAMPAIGN_ID_OVERRIDES)).length > 0
      ? parseWinningCampaignIdOverrides(process.env.WINNING_CAMPAIGN_ID_OVERRIDES)
      : {
          Lumus: ["120242098103810068", "120245920735870068"],
          Astrotalk: ["120246969425560130"],
        },
  // Runs inside the app itself (see instrumentation.ts + services/scheduler.ts) — only fires
  // while a persistent server process is up, which is exactly the hosting model this app needs
  // anyway (see cache/store.ts). Fires every intervalHours since the last sync (manual click or
  // auto), not tied to a fixed clock hour.
  autoSync: {
    enabled: (process.env.AUTO_SYNC_ENABLED ?? "true") !== "false",
    intervalHours: Number(process.env.AUTO_SYNC_INTERVAL_HOURS ?? 12),
  },
  // Daily Slack leaderboard (services/scheduler.ts + services/slackNotifier.ts) — a text-only
  // message posted by the server itself, no public URL needed. Disabled (no-op) whenever
  // SLACK_WEBHOOK_URL is unset; the time/timezone fields have sane defaults.
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL ?? "",
    // 24h "HH:MM", checked against leaderboardTimezone's current time — not a fixed UTC hour,
    // since the whole point is lining up with the team's actual workday regardless of which
    // timezone the server process happens to run in.
    leaderboardTime: process.env.SLACK_LEADERBOARD_TIME ?? "23:45",
    leaderboardTimezone: process.env.SLACK_LEADERBOARD_TIMEZONE ?? "Asia/Kolkata",
  },
  // Backfills a Google Sheet "database" (one tab per business unit) after every sync — an Apps
  // Script Web App bound to that sheet, not the Sheets API directly (no service-account/OAuth
  // setup needed; the script already runs under the sheet owner's own permissions). Disabled
  // (no-op) whenever SHEET_BACKFILL_WEBHOOK_URL is unset. See services/sheetBackfillService.ts.
  sheetBackfill: {
    webhookUrl: process.env.SHEET_BACKFILL_WEBHOOK_URL ?? "",
    secret: process.env.SHEET_BACKFILL_SECRET ?? "",
    // The same sheet's ID, needed separately from the webhook above — the webhook can only write
    // (Apps Script), so reading last-known enrichment back (see backfillReader.ts) goes through
    // the ordinary zero-credential public-CSV read path, same as every other configured sheet.
    sheetId: process.env.SHEET_BACKFILL_SHEET_ID ?? "",
  },
  // The floor between live Meta fetches, independent of how often runSync() itself is called
  // (manual clicks, the 12-hourly auto-sync, the daily Slack-leaderboard sync) — confirmed real
  // case: repeated manual syncs during heavy testing tripped Meta's account-level AND
  // application-level rate limits multiple times in one session. Enforced inside runSync itself
  // (not the scheduler or a single route) so every trigger is covered uniformly. When skipped,
  // enrichment falls back to the backfill sheet's last-known data (see backfillReader.ts) rather
  // than going live — see syncService.ts's runSync.
  metaSyncMinIntervalHours: Number(process.env.META_SYNC_MIN_INTERVAL_HOURS ?? 24),
};

export function isMetaAdsConfigured(): boolean {
  return Boolean(config.metaAds.accessToken && config.metaAds.adAccountIds.length > 0);
}
