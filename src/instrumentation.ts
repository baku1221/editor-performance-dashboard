// Next.js calls register() exactly once when the server process boots (both `next dev` and
// `next start`) — the standard hook for one-time server-side setup like this scheduler.
// See next.config.mjs (experimental.instrumentationHook) for Next 14.x.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDailySyncScheduler } = await import("./lib/services/scheduler");
    startDailySyncScheduler();
  }
}
