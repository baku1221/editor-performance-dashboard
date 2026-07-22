// Client-side filter state shape + query-string builder. Mirrors the server's
// DashboardFilters (src/lib/filters.ts) field-for-field so every tab's fetch
// URL is built the same way.

export interface UiFilters {
  from: string; // '' = unset
  to: string; // '' = unset
  editor: string; // '' = all editors
}

export const emptyFilters: UiFilters = { from: "", to: "", editor: "" };

// The team is India-based and every other "today"/date-window calculation in this app (the
// Slack leaderboard, the sync window) is deliberately anchored to Asia/Kolkata — this must match,
// or "today" here can silently read as yesterday for any viewer whose browser/OS clock is set to
// a timezone behind IST (e.g. a US-based browser late at night IST but still "yesterday" locally).
const DASHBOARD_TIMEZONE = "Asia/Kolkata";

/** "yyyy-MM-dd" for the current moment, as that calendar day reads in `timeZone` — not the browser's local timezone. */
function todayInTimezone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Initial filter state on page load — "This month" through today, not "Clear filters"'s Maximum. */
export function defaultFilters(): UiFilters {
  const to = todayInTimezone(DASHBOARD_TIMEZONE);
  return { from: `${to.slice(0, 7)}-01`, to, editor: "" };
}

export function buildQueryString(filters: UiFilters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.editor) params.set("editor", filters.editor);
  return params.toString();
}
