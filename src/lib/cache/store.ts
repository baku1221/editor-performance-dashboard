import type { ProgressItem, PublishedVideo, SyncStatus } from "../types";

// In-memory data store — the ONLY place that holds mutable dashboard state.
//
// This intentionally mimics the shape a database would hold, so that
// swapping repositories to a real DB later means reimplementing the
// Repository interfaces in src/lib/repositories/*, not touching services,
// API routes, or the UI. Data lives for the lifetime of the server process
// and is repopulated by /api/sync (Sheets + Meta). AI Credits is a separate,
// fully client-side widget (see src/lib/creditsDashboard.ts) — it has no
// server-side state here.

interface Store {
  publishedVideos: PublishedVideo[];
  progress: ProgressItem[];
  manualWinningOverrides: Map<string, boolean>;
  syncStatus: SyncStatus;
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
  };
}

// Survives Next.js dev-mode module reloads by hanging off globalThis.
const globalForStore = globalThis as unknown as { __editorDashboardStore?: Store };

export const store: Store = globalForStore.__editorDashboardStore ?? createEmptyStore();
globalForStore.__editorDashboardStore = store;
