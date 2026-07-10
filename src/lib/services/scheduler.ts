import { config } from "../config";
import { runSync } from "./syncService";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — coarse enough to be cheap, fine enough not to miss the target hour

/** IST hour + calendar date, independent of whatever timezone the server itself runs in. */
function istParts(date: Date): { hour: number; dateKey: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { hour: Number(get("hour")), dateKey: `${get("year")}-${get("month")}-${get("day")}` };
}

interface SchedulerState {
  started: boolean;
  lastAutoSyncDateKey: string | null;
}

// Same globalThis trick as cache/store.ts — survives Next.js dev-mode module reloads so the
// interval doesn't get duplicated on every hot reload.
const globalForScheduler = globalThis as unknown as { __editorDashboardScheduler?: SchedulerState };
const state: SchedulerState = globalForScheduler.__editorDashboardScheduler ?? { started: false, lastAutoSyncDateKey: null };
globalForScheduler.__editorDashboardScheduler = state;

async function checkAndSync(): Promise<void> {
  const { hour, dateKey } = istParts(new Date());
  if (hour !== config.autoSync.hourIst) return;
  if (state.lastAutoSyncDateKey === dateKey) return; // already synced during this hour today

  state.lastAutoSyncDateKey = dateKey;
  try {
    await runSync();
    console.log(`[scheduler] Daily auto-sync completed at ${new Date().toISOString()} (IST date ${dateKey})`);
  } catch (err) {
    console.error("[scheduler] Daily auto-sync failed:", err);
  }
}

/** Called once from instrumentation.ts when the server process boots. */
export function startDailySyncScheduler(): void {
  if (!config.autoSync.enabled) return;
  if (state.started) return;
  state.started = true;

  console.log(`[scheduler] Daily auto-sync enabled — will run once daily around ${config.autoSync.hourIst}:00 IST.`);
  setInterval(() => {
    checkAndSync().catch((err) => console.error("[scheduler] Unexpected error:", err));
  }, CHECK_INTERVAL_MS);
}
