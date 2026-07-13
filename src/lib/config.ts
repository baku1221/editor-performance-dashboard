import type { WinningRuleConfig, WinningRuleMetric, WinningRuleOperator } from "./types";

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

// Explicit, user-confirmed exceptions where a sheet row's title genuinely doesn't match the
// live Meta ad (a real typo/rename in the sheet, not just a pod-code addition) — too risky to
// auto-match by title, so these map the exact Meta Ad ID straight to its Drive folder instead.
// Format: "metaAdId|driveLink,metaAdId2|driveLink2".
function parseManualDriveLinkOverrides(value: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of csv(value)) {
    const [adId, driveLink] = entry.split("|").map((s) => s.trim());
    if (adId && driveLink) map[adId] = driveLink;
  }
  return map;
}

// Explicit, user-confirmed exceptions where Meta's created_time doesn't reflect when a video was
// actually made — confirmed real case: duplicating an ad on Meta stamps the duplicate with a
// fresh created_time at the moment of duplication, not the original creation date, so a video
// scripted in June can show as "created" in July once its live ad gets duplicated. Overrides
// createdDate for the given ad id so date-range filtering (e.g. "This month") reflects the
// video's real origin instead of Meta's duplicate-timestamp artifact.
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
  // Sidesteps the Meta permission wall on video duration entirely: these sheets already link
  // each ad to a Google Drive folder containing the source video file. One sheet per business
  // unit ("Lumus AI Creatives", "Astrotalk AI Creatives", "Astrotalk Store AI Creatives") —
  // joined by title (see normalizeTitleForMatching), since the ad id logged in the sheet is
  // usually a different campaign's duplicate of the same underlying video, not the exact id
  // this dashboard tracks.
  driveCreativeSheets: [
    {
      sheetId: process.env.DRIVE_CREATIVE_SHEET_ID ?? "",
      tabs: csv(process.env.DRIVE_CREATIVE_SHEET_TABS).length > 0 ? csv(process.env.DRIVE_CREATIVE_SHEET_TABS) : ["July 2026"],
    },
    {
      sheetId: process.env.DRIVE_CREATIVE_SHEET_ID_2 ?? "",
      tabs: csv(process.env.DRIVE_CREATIVE_SHEET_TABS_2).length > 0 ? csv(process.env.DRIVE_CREATIVE_SHEET_TABS_2) : ["July 2026"],
    },
    {
      sheetId: process.env.DRIVE_CREATIVE_SHEET_ID_3 ?? "",
      tabs: csv(process.env.DRIVE_CREATIVE_SHEET_TABS_3).length > 0 ? csv(process.env.DRIVE_CREATIVE_SHEET_TABS_3) : ["July 2026"],
    },
  ].filter((s) => s.sheetId),
  manualDriveLinkOverrides: parseManualDriveLinkOverrides(process.env.DRIVE_LINK_MANUAL_OVERRIDES),
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
  // Runs inside the app itself (see instrumentation.ts + services/scheduler.ts) — only fires
  // while a persistent server process is up, which is exactly the hosting model this app needs
  // anyway (see cache/store.ts). Fires every intervalHours since the last sync (manual click or
  // auto), not tied to a fixed clock hour.
  autoSync: {
    enabled: (process.env.AUTO_SYNC_ENABLED ?? "true") !== "false",
    intervalHours: Number(process.env.AUTO_SYNC_INTERVAL_HOURS ?? 12),
  },
};

export function isMetaAdsConfigured(): boolean {
  return Boolean(config.metaAds.accessToken && config.metaAds.adAccountIds.length > 0);
}
