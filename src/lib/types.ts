// Domain types shared across data sources, repositories, services, and the UI.
// Keeping these independent of any storage mechanism is what lets a real
// database replace the in-memory repositories later without touching callers.

// "Not Started" reflects real sheet data (unassigned backlog ideas) — the
// original Working/Review/Completed/Delayed set doesn't cover that state.
// There's no deadline column in the real sheet, so "Delayed" only appears if
// the sheet itself says so; it's never derived from an overdue date.
export type ProgressStatus = "Not Started" | "Working" | "Review" | "Completed" | "Delayed";

export interface ProgressItem {
  id: string;
  editorName: string; // "Unassigned" when the sheet's Editor cell is blank
  videoName: string; // Ad Name column
  currentStage: string; // raw Status text from the sheet, e.g. "In Progress"
  status: ProgressStatus; // currentStage normalized into a fixed bucket for color coding
  startedDate: string; // ISO date, from Posted Date
  completedDate: string; // ISO date, from Completed Date / Date done; '' if not done yet
  cohort: string; // which sheet tab this came from, e.g. "Foreign" | "Lumus"
  // Joined against PublishedVideo (by editor + concept-title match) once the sheet's "Completed"
  // video is actually live on Meta — there's often a lag, so both are null until it is.
  matchedIsWinning: boolean | null;
  matchedDurationSeconds: number | null;
}

/**
 * The "<Business> AI Creatives" sheet row IS the video, now — every logged row counts as a
 * video regardless of whether it's live on Meta yet (editors' work should be visible as soon as
 * it's scripted/edited, not just once published). Meta is an enrichment source layered on top:
 * when a row can be matched to a live ad, takenLive is true and the metric fields carry Meta's
 * real numbers; when it can't (not published yet, or genuinely absent from the sheet), takenLive
 * is false and the metric fields sit at their empty defaults. Editor attribution comes from the
 * sheet's own Editor column when present, falling back to parsing the ad-title naming convention
 * (see services/editorTitleParser.ts) for sheets that don't have an Editor column at all.
 */
export interface PublishedVideo {
  id: string; // Meta ad id when takenLive, else a stable id derived from the sheet row
  accountId: string | null; // Meta ad account id — null when not takenLive
  businessUnit: string; // human label, e.g. "Lumus" | "Astrotalk" | "Astrotalk Store"
  campaignName: string;
  adName: string;
  editorName: string | null; // null = neither the sheet's Editor column nor title parsing matched the roster
  videoKind: "Main" | "Cut" | null; // from the ad title's middle segment; null = title didn't have one
  createdDate: string; // ISO date used for date-range filtering/aggregation — Meta's created_time when takenLive (month-boundary corrected), else sheetCreatedDate
  sheetCreatedDate: string; // ISO date the row was logged/made per the "<Business> AI Creatives" sheet itself — always best-effort populated when available, regardless of takenLive
  publishedDate: string | null; // ISO date Meta reports as this ad's created_time — only set once takenLive is true, uncorrected (the raw Meta value, not the month-boundary-adjusted createdDate)
  effectiveStatus: string; // Meta's effective_status when takenLive, else "Not Live"
  takenLive: boolean; // true once this sheet row is matched to an actual ad currently live on Meta
  spend: number;
  impressions: number;
  ctr: number;
  cpm: number;
  cpc: number;
  conversions: number | null;
  cpa: number | null; // spend / conversions, using META_CONVERSION_ACTION_TYPES
  durationSeconds: number | null; // from the sheet row's own Drive link; independent of takenLive
  isWinning: boolean;
  winningSource: "rule" | "manual" | null;
}

export interface DateRangeFilter {
  from?: string; // ISO date, inclusive
  to?: string; // ISO date, inclusive
}

export interface DashboardFilters {
  dateRange?: DateRangeFilter;
  editorName?: string;
}

export type WinningRuleMetric = "spend" | "cpi" | "cpa" | "ctr" | "cpc" | "cpm";
export type WinningRuleOperator = "lt" | "gt" | "lte" | "gte";

export interface WinningRuleConfig {
  metric: WinningRuleMetric;
  operator: WinningRuleOperator;
  value: number;
}

export interface EditorPerformanceRow {
  editorName: string;
  businessUnit: string;
  videosSubmitted: number; // all ads: Main + Cut + unclassified
  mainAdsCount: number; // ads whose title's stage segment says "Main" — the unique/primary edits, cuts excluded
  winningCreatives: number;
  winningPercent: number;
  activeCreatives: number;
  totalDurationSeconds: number;
}

export interface PerformanceSummary {
  totalVideosSubmitted: number; // "Total Ads (with Cuts)" in the UI
  totalMainAds: number; // "Total Unique Ads (Main)" in the UI
  winningCreatives: number;
  winningPercent: number;
  totalEditors: number;
  dateRange: { from: string; to: string } | null; // the configured analysis window (since -> today), not derived from the data
}

export interface BusinessUnitPerformance {
  businessUnit: string;
  summary: PerformanceSummary;
}

export interface PerformanceData {
  businessUnits: BusinessUnitPerformance[];
  rows: EditorPerformanceRow[]; // flat across all business units; each row carries its own businessUnit
  // Business units still selectable as their own tab, but excluded from the combined "All" view
  // (config.excludedFromAllView) — e.g. a newer ad account being tracked in isolation. Sent to
  // the client rather than read from server config directly, since that config module isn't
  // meant to be imported into client components.
  excludedFromAllView: string[];
}

export interface EditorDetail {
  editorName: string;
  videos: PublishedVideo[];
}

export interface SyncStatus {
  lastSyncedAt: string | null;
  sources: Record<
    "googleSheetsProgress" | "metaAds",
    { ok: boolean; message?: string; fetchedAt: string | null }
  >;
}
