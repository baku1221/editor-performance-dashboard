import { config } from "../config";
import { store } from "../cache/store";
import { runSync } from "./syncService";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — coarse enough to be cheap, fine enough not to drift far past the target interval

interface SchedulerState {
  started: boolean;
}

// Same globalThis trick as cache/store.ts — survives Next.js dev-mode module reloads so the
// interval doesn't get duplicated on every hot reload.
const globalForScheduler = globalThis as unknown as { __editorDashboardScheduler?: SchedulerState };
const state: SchedulerState = globalForScheduler.__editorDashboardScheduler ?? { started: false };
globalForScheduler.__editorDashboardScheduler = state;

/**
 * Fires a sync once at least intervalHours have passed since the last sync — whichever kind:
 * this reads store.syncStatus.lastSyncedAt directly (the same field the manual "Sync now" button
 * updates), so clicking the button resets the clock and the next auto-sync waits a full interval
 * from THAT click, instead of double-syncing shortly after.
 */
async function checkAndSync(): Promise<void> {
  const intervalMs = config.autoSync.intervalHours * 60 * 60 * 1000;
  const lastSyncedAt = store.syncStatus.lastSyncedAt;
  const elapsedMs = lastSyncedAt ? Date.now() - new Date(lastSyncedAt).getTime() : Infinity;
  if (elapsedMs < intervalMs) return;

  try {
    await runSync();
    console.log(`[scheduler] Auto-sync completed at ${new Date().toISOString()} (interval: ${config.autoSync.intervalHours}h)`);
  } catch (err) {
    console.error("[scheduler] Auto-sync failed:", err);
  }
}

/** Called once from instrumentation.ts when the server process boots. */
export function startDailySyncScheduler(): void {
  if (!config.autoSync.enabled) return;
  if (state.started) return;
  state.started = true;

  console.log(`[scheduler] Auto-sync enabled — will run every ${config.autoSync.intervalHours} hours since the last sync (manual or auto).`);
  setInterval(() => {
    checkAndSync().catch((err) => console.error("[scheduler] Unexpected error:", err));
  }, CHECK_INTERVAL_MS);
}
