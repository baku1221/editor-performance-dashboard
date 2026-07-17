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

function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/**
 * Formats a "yyyy-MM-dd" date (already resolved to the target timezone's calendar day, e.g. via
 * getTimezoneNow) into "Friday, 17th July 2026" for the Slack leaderboard header. Builds the Date
 * from UTC parts and formats in UTC — the input is just calendar digits at this point, not an
 * instant, so no further timezone conversion is needed or wanted.
 */
export function formatFriendlyDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const asDate = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(asDate);
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(asDate);
  return `${weekday}, ${ordinal(day ?? 1)} ${monthName} ${year}`;
}
