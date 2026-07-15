/**
 * "Today"/"this month" for the Slack leaderboard should mean IST calendar dates regardless of
 * which timezone the server process itself runs in (Railway/local dev could differ) — the whole
 * point of a daily leaderboard is that it lines up with the team's actual workday. Uses
 * Intl.DateTimeFormat rather than a date library dependency; Node has full ICU support built in.
 */
export function getTimezoneNow(timeZone: string): { date: string; hhmm: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hhmm: `${get("hour")}:${get("minute")}`,
  };
}

/** First day of the current month, as "yyyy-MM-01", per the given timezone's calendar. */
export function getTimezoneMonthStart(timeZone: string): string {
  const { date } = getTimezoneNow(timeZone);
  return `${date.slice(0, 7)}-01`;
}
