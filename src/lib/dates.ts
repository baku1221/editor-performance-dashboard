import { format, isValid, parse } from "date-fns";

// The real sheets use day-first delimited dates — most with slashes ("25/05/2026", "1/07/26"),
// at least one ("Astrotalk AI Creatives") with dashes instead ("01-07-26") — JS's generic
// `new Date(...)` parses ambiguous delimited dates as US month-first and silently gets the
// wrong date (or Invalid Date for day > 12), so day-first formats are tried explicitly before
// falling back to the generic parser.
const DELIMITED_DATE_FORMATS = ["d/M/yyyy", "d/M/yy", "d-M-yyyy", "d-M-yy"];

/**
 * Google Sheets date cells can come through as "2026-07-08", "25/05/2026",
 * "1/07/26", or a locale-formatted string depending on cell formatting.
 * Normalize everything to an ISO yyyy-MM-dd string so the rest of the app
 * can do plain string comparisons for filtering/sorting.
 */
export function normalizeToIsoDate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Already yyyy-MM-dd, optionally with a time/offset suffix (e.g. Meta's created_time
  // "2026-07-01T00:57:48+0530") — take the date portion directly instead of round-tripping
  // through a parsed Date + format(). Confirmed real bug: format() renders using the RUNNING
  // PROCESS's local system timezone, which silently shifts the calendar date by a day for
  // timestamps near midnight when two environments run in different timezones — a Mac in IST
  // and a Railway container in UTC gave different dates for the same "00:57 IST" ad, in turn
  // pushing that ad below the account's since-date boundary on one of them. Meta already reports
  // the date in the ad account's own timezone; slicing sidesteps environment-dependent re-rendering.
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);

  if (trimmed.includes("/") || trimmed.includes("-")) {
    for (const pattern of DELIMITED_DATE_FORMATS) {
      const parsed = parse(trimmed, pattern, new Date());
      if (!isValid(parsed)) continue;

      // date-fns's "yy" token parses "26" as the literal year 26, not 2026 — no century
      // inference by design. All real dates here are 2000s, so correct it explicitly.
      const corrected =
        parsed.getFullYear() < 100
          ? new Date(parsed.getFullYear() + 2000, parsed.getMonth(), parsed.getDate())
          : parsed;

      return format(corrected, "yyyy-MM-dd");
    }
  }

  const fallback = new Date(trimmed);
  if (isValid(fallback)) return format(fallback, "yyyy-MM-dd");

  return trimmed;
}
