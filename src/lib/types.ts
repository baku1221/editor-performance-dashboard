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
 * A published Meta ad IS the video: editors' work only counts once it's live
 * on Meta, so there's no separate "completed video" entity to reconcile
 * against a manually-updated sheet. Editor attribution comes directly from
 * parsing the ad title (see services/editorTitleParser.ts).
 */
export interface PublishedVideo {
  id: string; // Meta ad id
  accountId: string;
  businessUnit: string; // human label for accountId, e.g. "Lumus" | "Astrotalk" — see config.metaAds.accountLabels
  campaignName: string;
  adName: string;
  editorName: string | null; // null = title didn't match the naming convention
  videoKind: "Main" | "Cut" | null; // from the ad title's middle segment; null = title didn't have one
  createdDate: string; // ISO date, from the ad's created_time
  effectiveStatus: string; // Meta's effective_status, e.g. ACTIVE / PAUSED / ARCHIVED
  spend: number;
  impressions: number;
  ctr: number;
  cpm: number;
  cpc: number;
  conversions: number | null;
  cpa: number | null; // spend / conversions, using META_CONVERSION_ACTION_TYPES
  durationSeconds: number | null; // from the ad creative's attached video; null if not a single-video creative
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
