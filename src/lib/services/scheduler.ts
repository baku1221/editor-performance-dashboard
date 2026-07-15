import { config } from "../config";
import { store } from "../cache/store";
import { runSync } from "./syncService";
import { sendDailyLeaderboardToSlack } from "./slackNotifier";
import { getTimezoneNow } from "../timezone";

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

/**
 * Fires at most once per IST (or configured timezone) calendar day, once the clock has crossed
 * config.slack.leaderboardTime — checked on the same 5-minute tick as checkAndSync, so it can be
 * up to 5 minutes late but never fires twice for the same day (guarded by
 * store.slackLeaderboardLastSentDate, not a precise one-shot timer).
 *
 * Runs its own sync immediately before sending — the periodic 12-hour auto-sync could have last
 * run many hours before the leaderboard time, so relying on it alone risks posting a stale
 * snapshot of the day's work. runSync() is resilient to its own internal failures (per-source
 * try/catch, never throws), so this is safe to call unconditionally.
 */
async function checkAndSendSlackLeaderboard(): Promise<void> {
  if (!config.slack.webhookUrl) return;

  const { date, hhmm } = getTimezoneNow(config.slack.leaderboardTimezone);
  if (hhmm < config.slack.leaderboardTime) return;
  if (store.slackLeaderboardLastSentDate === date) return;

  try {
    await runSync();
    await sendDailyLeaderboardToSlack();
    store.slackLeaderboardLastSentDate = date;
    console.log(`[scheduler] Synced and sent Slack leaderboard for ${date}`);
  } catch (err) {
    console.error("[scheduler] Slack sync+send failed:", err);
  }
}

/** Called once from instrumentation.ts when the server process boots. */
export function startDailySyncScheduler(): void {
  if (!config.autoSync.enabled && !config.slack.webhookUrl) return;
  if (state.started) return;
  state.started = true;

  if (config.autoSync.enabled) {
    console.log(`[scheduler] Auto-sync enabled — will run every ${config.autoSync.intervalHours} hours since the last sync (manual or auto).`);
  }
  if (config.slack.webhookUrl) {
    console.log(
      `[scheduler] Slack leaderboard enabled — will send once daily at ${config.slack.leaderboardTime} ${config.slack.leaderboardTimezone}.`
    );
  }

  setInterval(() => {
    if (config.autoSync.enabled) {
      checkAndSync().catch((err) => console.error("[scheduler] Unexpected error:", err));
    }
    checkAndSendSlackLeaderboard().catch((err) => console.error("[scheduler] Unexpected error:", err));
  }, CHECK_INTERVAL_MS);
}
