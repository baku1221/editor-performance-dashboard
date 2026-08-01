import { config } from "../config";
import { store } from "../cache/store";
import { runSync } from "./syncService";
import { sendDailyLeaderboardToSlack, sendMonthlyReportToSlack } from "./slackNotifier";
import { getTimezoneNow, getTimezoneMonthStart, isLastDayOfMonth, isWeekend } from "../timezone";

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
 * store.slackLeaderboardLastSentDate, not a precise one-shot timer). Skipped entirely on
 * Saturday/Sunday — the team is off those days, so there's no "editor videos today" to report.
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
  if (isWeekend(config.slack.leaderboardTimezone)) return;

  try {
    await runSync();
    await sendDailyLeaderboardToSlack();
    store.slackLeaderboardLastSentDate = date;
    console.log(`[scheduler] Synced and sent Slack leaderboard for ${date}`);
  } catch (err) {
    console.error("[scheduler] Slack sync+send failed:", err);
  }
}

/**
 * Fires at most once per IST (or configured timezone) calendar day, once the clock has crossed
 * config.metaSyncDaily.time — a deterministic daily live-Meta moment, independent of the rolling
 * 12h auto-sync + 24h metaSyncMinIntervalHours combination above (which lands the actual live
 * fetch at a somewhat unpredictable moment each day). forceMeta bypasses that interval gate
 * entirely, and the sync's own backfillDatabaseSheet call (already unconditional in
 * runSyncExclusive) satisfies "backfill the sheet at that same time" for free.
 */
async function checkAndRunDailyMetaSync(): Promise<void> {
  const { date, hhmm } = getTimezoneNow(config.metaSyncDaily.timezone);
  if (hhmm < config.metaSyncDaily.time) return;
  if (store.metaSyncDailyLastRunDate === date) return;

  try {
    await runSync({ forceMeta: true });
    store.metaSyncDailyLastRunDate = date;
    console.log(`[scheduler] Daily forced Meta sync + sheet backfill completed for ${date}`);
  } catch (err) {
    console.error("[scheduler] Daily forced Meta sync failed:", err);
  }
}

/**
 * Fires once, on the last calendar day of the month, at the same Slack leaderboard time (after
 * that day's normal leaderboard message has already gone out) — a second, more detailed message:
 * the month's business-unit totals plus top/bottom-5 rankings (see monthlyReportService.ts).
 * Guarded by store.monthlyReportLastSentMonth ("yyyy-MM") so it can't double-send even though the
 * scheduler checks every 5 minutes across the whole last day.
 */
async function checkAndSendMonthlyReport(): Promise<void> {
  if (!config.slack.webhookUrl) return;

  const { date, hhmm } = getTimezoneNow(config.slack.leaderboardTimezone);
  if (hhmm < config.slack.leaderboardTime) return;
  if (!isLastDayOfMonth(config.slack.leaderboardTimezone)) return;

  const month = date.slice(0, 7);
  if (store.monthlyReportLastSentMonth === month) return;

  try {
    const monthStart = getTimezoneMonthStart(config.slack.leaderboardTimezone);
    await sendMonthlyReportToSlack(monthStart, date);
    store.monthlyReportLastSentMonth = month;
    console.log(`[scheduler] Sent monthly Slack report for ${month}`);
  } catch (err) {
    console.error("[scheduler] Monthly Slack report failed:", err);
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
  console.log(
    `[scheduler] Daily Meta sync + sheet backfill enabled — will run once daily at ${config.metaSyncDaily.time} ${config.metaSyncDaily.timezone}.`
  );
  if (config.slack.webhookUrl) {
    console.log(
      `[scheduler] Slack leaderboard enabled — will send once daily at ${config.slack.leaderboardTime} ${config.slack.leaderboardTimezone}, plus a detailed monthly report on the last day of each month.`
    );
  }

  setInterval(() => {
    if (config.autoSync.enabled) {
      checkAndSync().catch((err) => console.error("[scheduler] Unexpected error:", err));
    }
    checkAndRunDailyMetaSync().catch((err) => console.error("[scheduler] Unexpected error:", err));
    // Sequenced, not concurrent — the monthly report is a follow-up to the daily leaderboard
    // message ("one normal message ... then one more message"), so it must only be checked/sent
    // after that day's leaderboard send has actually gone out (or been confirmed already sent).
    checkAndSendSlackLeaderboard()
      .then(() => checkAndSendMonthlyReport())
      .catch((err) => console.error("[scheduler] Unexpected error:", err));
  }, CHECK_INTERVAL_MS);
}
