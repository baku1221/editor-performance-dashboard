import type { ProgressItem, PublishedVideo, SyncStatus } from "../types";
import type { CreditRow } from "../creditsDashboard";
import type { InHouseAdsWinningIndex } from "../datasources/metaAds/inHouseAdsWinning";

// In-memory data store — the ONLY place that holds mutable dashboard state.
//
// This intentionally mimics the shape a database would hold, so that
// swapping repositories to a real DB later means reimplementing the
// Repository interfaces in src/lib/repositories/*, not touching services,
// API routes, or the UI. Data lives for the lifetime of the server process
// and is repopulated by /api/sync (Sheets + Meta).

interface CreditsData {
  rows: CreditRow[];
  fileName: string;
  uploadedAt: string; // ISO timestamp
}

interface Store {
  publishedVideos: PublishedVideo[];
  progress: ProgressItem[];
  manualWinningOverrides: Map<string, boolean>;
  syncStatus: SyncStatus;
  // Last IST calendar date ("yyyy-MM-dd") the daily Slack leaderboard was sent, so the scheduler
  // sends at most once per day even though it checks every 5 minutes. In-memory (not
  // file-persisted like editorRosterRepository) — worst case on a same-day redeploy is one
  // duplicate or one skipped send, low-stakes compared to editor roster data.
  slackLeaderboardLastSentDate: string | null;
  // Same one-shot-per-day guard as slackLeaderboardLastSentDate, for the fixed-time daily Meta
  // sync (config.metaSyncDaily) — worst case on a same-day redeploy is one skipped or duplicate
  // forced sync, no different in risk from the leaderboard guard above.
  metaSyncDailyLastRunDate: string | null;
  // Last month ("yyyy-MM") the end-of-month Slack report was sent, so it fires at most once even
  // though the scheduler checks every 5 minutes across the whole last calendar day of the month.
  monthlyReportLastSentMonth: string | null;
  // The AI Credits tab's most recently uploaded CSV — parsed client-side, then persisted here so
  // it survives a page refresh instead of vanishing (it used to live only in React state).
  // Uploading a new CSV replaces this outright; there's no history of prior uploads.
  creditsData: CreditsData | null;
  // The In House Ads Copy Writer group's own winning-check result (see
  // config.inHouseAdsWinningRule + inHouseAdsWinning.ts) — only refreshed when this sync cycle
  // actually fetches Meta live (same fetchMetaLive gate as the main Meta index); otherwise the
  // last-known result here is reused as-is, same "don't revert to unknown just because today
  // wasn't a Meta-fetch day" principle as the main sync's backfill-sheet fallback, just via an
  // in-memory cache instead of a persisted sheet (lower stakes: Copy Writer tab-only, not the
  // Performance tab).
  inHouseAdsWinning: InHouseAdsWinningIndex;
}

function createEmptyStore(): Store {
  return {
    publishedVideos: [],
    progress: [],
    manualWinningOverrides: new Map(),
    syncStatus: {
      lastSyncedAt: null,
      sources: {
        googleSheetsProgress: { ok: false, fetchedAt: null },
        metaAds: { ok: false, fetchedAt: null },
      },
    },
    slackLeaderboardLastSentDate: null,
    metaSyncDailyLastRunDate: null,
    monthlyReportLastSentMonth: null,
    creditsData: null,
    inHouseAdsWinning: { testedTitles: {}, winningTitles: {} },
  };
}

// Survives Next.js dev-mode module reloads by hanging off globalThis.
const globalForStore = globalThis as unknown as { __editorDashboardStore?: Store };

export const store: Store = globalForStore.__editorDashboardStore ?? createEmptyStore();
globalForStore.__editorDashboardStore = store;
