import { format, isValid, parse, parseISO } from "date-fns";

// The real sheets use day-first slash dates ("25/05/2026", "1/07/26") — JS's
// generic `new Date(...)` parses ambiguous slash dates as US month-first and
// silently gets the wrong date (or Invalid Date for day > 12), so day-first
// formats are tried explicitly before falling back to the generic parser.
const SLASH_DATE_FORMATS = ["d/M/yyyy", "d/M/yy"];

/**
 * Google Sheets date cells can come through as "2026-07-08", "25/05/2026",
 * "1/07/26", or a locale-formatted string depending on cell formatting.
 * Normalize everything to an ISO yyyy-MM-dd string so the rest of the app
 * can do plain string comparisons for filtering/sorting.
 */
export function normalizeToIsoDate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const iso = parseISO(trimmed);
  if (isValid(iso) && /^\d{4}-\d{2}-\d{2}/.test(trimmed)) return format(iso, "yyyy-MM-dd");

  if (trimmed.includes("/")) {
    for (const pattern of SLASH_DATE_FORMATS) {
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
