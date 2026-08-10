import { config } from "../../config";
import { normalizeToIsoDate } from "../../dates";
import { fetchSheetTable } from "./client";
import { formatMonthLabel, getTimezoneMonthStart } from "../../timezone";

export interface DriveCreativeRow {
  metaAdId: string;
  editorName: string; // '' when this sheet has no Editor column at all (e.g. Astrotalk Store) — caller falls back to title parsing
  name: string; // ad title, as entered in this sheet
  driveLink: string; // Drive folder URL containing the source video file; '' if not logged yet
  businessUnit: string; // which "<Business> AI Creatives" sheet this row came from
  sourceMonth: string; // "yyyy-MM", parsed from the tab name (e.g. "July 2026" -> "2026-07")
  dateMade: string; // best-effort per-row date if this sheet has one; '' otherwise
}

const MONTH_NUMBERS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

/** Parses a tab name like "July 2026" into "2026-07" — empty string if it doesn't match that shape.
 * Exported for reuse by inHouseAds.ts, which follows the same monthly-tab convention. */
export function parseTabMonth(tabName: string): string {
  const match = tabName.trim().toLowerCase().match(/^([a-z]+)\s+(\d{4})$/);
  if (!match) return "";
  const [, monthName, year] = match;
  const monthNumber = monthName ? MONTH_NUMBERS[monthName] : undefined;
  return monthNumber ? `${year}-${monthNumber}` : "";
}

/**
 * Ensures the CURRENT calendar month's tab (e.g. "August 2026") is always included alongside
 * whatever historical tabs are configured (DRIVE_CREATIVE_SHEET_TABS* in .env.local) — confirmed
 * real gap: those env vars only listed past months, so as soon as a new month started, that
 * month's real, populated tab (created by the team following their own naming convention) was
 * silently never read until someone manually added it. Computed fresh on every call (not baked
 * into the static config object), since a long-lived server process can now run for weeks without
 * restarting — see config.metaSyncDaily — and a value computed once at process boot would go
 * stale the moment the month rolled over. Only applied to sheets that already use this naming
 * convention (at least one existing tab parses as a month) — a sheet like Astrotalk Store's second
 * one, whose tabs are "india"/"native", isn't month-based at all and is left untouched.
 */
export function withCurrentMonthTab(tabs: string[]): string[] {
  if (!tabs.some((t) => parseTabMonth(t) !== "")) return tabs;
  const current = formatMonthLabel(getTimezoneMonthStart("Asia/Kolkata"));
  return tabs.includes(current) ? tabs : [current, ...tabs];
}

const HEADER_ALIASES = {
  // "content" is the Social Media sheet's own header for this column ("Content", not "Name") —
  // added as an alias rather than a positional fallback since it's a real, reliably-present label
  // there, not a blank/corrupted header like the other sheets' quirks below.
  name: ["name", "content"],
  editorName: ["editor"],
  link: ["link"],
  metaAdId: ["metaadid"],
  // Deliberately NOT a bare "date" alias — confirmed real bug: the Lumus sheet has a "Live date"
  // column (Meta-publish-related, always blank in practice) whose normalized text "livedate"
  // contains "date" as a substring, so a bare "date" alias matched IT instead of the sheet's real
  // per-row creation date (a blank-header column with genuine values like "1/7/2026", located via
  // the link+1 positional fallback below) — every Lumus row silently fell back to the tab's own
  // month instead of its actual day. "uploaddates" is kept as a specific, safe alias for a sheet
  // that genuinely labels this column that way.
  dateMade: ["uploaddates"],
  category: ["category"],
  type: ["type"],
} as const;

type Field = keyof typeof HEADER_ALIASES;

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A column that's either genuinely blank, or has one of a small, specific set of confirmed-safe
 * date-ish labels — used by the positional dateMade fallbacks below. Switching the underlying
 * fetch from gviz to /export (see client.ts) revealed that several of these "blank header"
 * columns were never actually blank — gviz itself was corrupting/dropping the label — they're
 * really "Date" (Astrotalk) or "Video Date" (Social Media). The plain `!normalized[i]` blank check
 * these fallbacks used to rely on stopped matching once the real label showed through, silently
 * un-locating the column. Deliberately NOT a general "includes date" substring check — that's the
 * exact false-positive shape as the Lumus "Live date" bug this file already documents ("videodate"
 * and "date" would otherwise collide with unrelated date-ish columns on other sheets) — only the
 * specific labels confirmed to live in each position are accepted.
 */
function isBlankOrKnownDateLabel(header: string | undefined, knownLabels: readonly string[]): boolean {
  if (!header) return true;
  return (knownLabels as string[]).includes(header);
}

/**
 * Substring match, not exact equality: this sheet's gviz CSV export garbles row 0 by fusing
 * the header label onto the first data row's value in the same cell (e.g. "Meta Ad ID
 * 120245223571090068" instead of just "Meta Ad ID") — exact equality against that text always
 * fails, which silently found zero columns and made every duration lookup a no-op. Substring
 * matching still finds "metaadid" inside the fused text. Confirmed safe against false
 * positives across this sheet's real headers (e.g. "Meta AdAccountID" does not contain
 * "metaadid" as a contiguous substring).
 */
function buildColumnLocator(headers: string[]): Partial<Record<Field, number>> {
  const normalized = headers.map(normalizeHeader);
  const locator: Partial<Record<Field, number>> = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[Field, readonly string[]]>) {
    const index = normalized.findIndex((h) => (aliases as string[]).some((alias) => h.includes(alias)));
    if (index !== -1) locator[field] = index;
  }

  // The Astrotalk sheet has a genuine per-row date column (real values like "01-07-26"),
  // confirmed reliably positioned immediately after "Category". Its header is blank under gviz
  // but reads exactly "Date" under /export (see isBlankOrKnownDateLabel) — either way, this is
  // the same "corrupted/hidden header, fall back to a known position" pattern already used for
  // the Progress Tracker sheet's Posted Date/Completed Date columns. Guarded so it can't misfire:
  // the Astrotalk Store sheet's "Category" column is immediately followed by a properly-labeled
  // "Link" column, neither blank nor "date".
  if (
    locator.dateMade === undefined &&
    locator.category !== undefined &&
    isBlankOrKnownDateLabel(normalized[locator.category + 1], ["date"])
  ) {
    locator.dateMade = locator.category + 1;
  }

  // The Social Media sheet puts its date column on the OTHER side of Link — a "Content, Editor,
  // Status, [date], Drive Link" layout, date immediately before the link column rather than
  // after. Confirmed 100% populated. Blank under gviz, reads exactly "Video Date" under /export.
  // Checked BEFORE the link+1 fallback below — confirmed real bug otherwise: this sheet also has
  // a genuinely blank, unused leftover column right after Link (a repeated-block template
  // artifact with no data in it at all), so link+1's check would misfire and claim that empty
  // column as the date instead, the same "wrong blank column wins" failure mode as the Lumus
  // "Live date" bug. Safe to check first: on every other configured sheet, the column before Link
  // is either a real non-blank, non-"date" header (Lumus's "Category", Astrotalk Store's
  // "Category") or coincides with the Astrotalk sheet's own category+1 slot (already claimed
  // above), so this can't misfire elsewhere.
  if (
    locator.dateMade === undefined &&
    locator.link !== undefined &&
    locator.link > 0 &&
    isBlankOrKnownDateLabel(normalized[locator.link - 1], ["videodate"])
  ) {
    locator.dateMade = locator.link - 1;
  }

  // Same story one column over on the Lumus sheet — genuine per-row dates ("1/7/2026" etc.,
  // 100% populated on July, sparser on June) sit in a blank-header column immediately after
  // "Link" on both tabs. Guarded the same way as above so it can't misfire on a sheet where Link
  // is genuinely followed by another labeled column.
  if (locator.dateMade === undefined && locator.link !== undefined && !normalized[locator.link + 1]) {
    locator.dateMade = locator.link + 1;
  }

  // Astrotalk Store's second sheet (the "india"/"native" tabs) puts a genuine per-row date
  // (e.g. "01/07/2026") in the very first column, ahead of "Name", with a blank header cell —
  // confirmed 100% populated across every row in both tabs. The original Astrotalk Store sheet
  // has the same blank-column-0-before-Name shape but only sparsely fills it in (real dates
  // where present, e.g. "08/07/2026"); wiring it here is still strictly better than leaving
  // those rows dateless. Guarded on the header being blank and Name existing right after it, so
  // this can't misfire on a sheet where column 0 is genuinely something else.
  if (locator.dateMade === undefined && locator.name !== undefined && locator.name > 0 && !normalized[locator.name - 1]) {
    locator.dateMade = locator.name - 1;
  }

  return locator;
}

function cellAt(row: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return (row[index] ?? "").trim();
}

/**
 * Reduces an ad title to a comparable form: lowercase, all punctuation/underscores/emoji
 * collapsed to single spaces, and a trailing "Copy" / "Copy N" token stripped (Meta appends
 * this when an ad is duplicated — same underlying video, same title otherwise). Confirmed
 * against real data: the sheet logs an ad's original title, but a duplicated copy of that same
 * ad running in a different campaign carries a different Meta Ad ID and a "– Copy" suffix —
 * this normalization is what lets those two ad records still resolve to the same Drive folder.
 */
/**
 * A trailing "main" in the concept segment (before the first "|") is an optional stage marker,
 * not part of the concept itself — confirmed real case: "iski shaadi nahi ho rhi hai" (June tab,
 * no marker) and "iski shaadi nahi ho rhi hai main" (July tab, same video re-logged a month later
 * with an explicit "main" added, likely when the editor went back through the sheet adding
 * clearer main/cut markers) are the same underlying video, but the added word defeated dedup's
 * exact-text match and inflated this editor's Main count by counting it twice. Stripped only from
 * the concept segment (not the whole title) so a genuine mid-sentence "main" elsewhere (e.g. the
 * Hindi word for "I" in "Bhagwan ji, main itna kaam karta hoon") is left alone, and only when
 * trailing so it can't accidentally eat a real word ending in "main". Never strips "cut"/"cuts" —
 * those always mark a genuinely different edited file and must stay significant.
 */
function stripTrailingMainMarker(title: string): string {
  const pipeIndex = title.indexOf("|");
  const concept = pipeIndex === -1 ? title : title.slice(0, pipeIndex);
  const rest = pipeIndex === -1 ? "" : title.slice(pipeIndex);
  return concept.replace(/\bmain\s*$/i, "") + rest;
}

export function normalizeTitleForMatching(title: string): string {
  const collapsed = stripTrailingMainMarker(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return collapsed.replace(/\s+copy(\s+\d+)?$/, "").trim();
}

/**
 * Reads every configured "<Business> AI Creatives" sheet (see config.driveCreativeSheets) — the
 * primary source of "what videos exist" now, one row per Main/Cut ad regardless of whether it's
 * live on Meta yet. A row only needs a Name to count; Editor/Link/Meta Ad ID are all optional
 * (missing Editor means the sheet doesn't track it at all for this business unit — caller falls
 * back to parsing it from the title; missing Link just means no duration yet).
 *
 * Each sheet/tab is isolated in its own try/catch — one sheet that isn't actually link-shared
 * (confirmed real case: a sheet added before its owner set "Anyone with the link can view"
 * returns an HTML login page instead of CSV) must not silently wipe out every OTHER business
 * unit's sheet too, which is what an un-isolated throw here would do.
 */
export async function fetchDriveCreativeRows(): Promise<DriveCreativeRow[]> {
  const rows: DriveCreativeRow[] = [];

  for (const sheet of config.driveCreativeSheets) {
    for (const tab of withCurrentMonthTab(sheet.tabs)) {
      try {
        const { headers, rows: dataRows } = await fetchSheetTable(sheet.sheetId, tab);
        const locator = buildColumnLocator(headers);
        const sourceMonth = parseTabMonth(tab);

        for (const row of dataRows) {
          const name = cellAt(row, locator.name);
          if (!name) continue; // nothing to identify this as a video at all
          // "Carousel" rows (Social Media sheet) are Canva image posts, not videos — confirmed
          // every single one is literally named "Carousel" with a canva.link Drive Link, a
          // perfectly reliable 1:1 signal across the whole sheet. Excluded globally rather than
          // scoped to one business unit since no OTHER sheet's real video titles would ever
          // collide with this literal name.
          if (name.toLowerCase() === "carousel") continue;
          // Static-image rows ("Static"/"AI Static" alongside "AI Video"/"video" in the Type
          // column) are excluded by default — this dashboard otherwise tracks video editor
          // output, not static creatives. Astrotalk India is the explicit exception, and only for
          // its July 2026 tab — the team wants that month's static output counted, but not
          // June's. Confirmed safe elsewhere: the original Astrotalk sheet also has a Type
          // column, but every single row there is already "AI Video" (no Static rows at all), so
          // this can't drop anything there regardless.
          const type = cellAt(row, locator.type).toLowerCase();
          const includeStatics = sheet.businessUnit === "Astrotalk India" && sourceMonth === "2026-07";
          if (type.includes("static") && !includeStatics) continue;

          rows.push({
            metaAdId: cellAt(row, locator.metaAdId),
            editorName: cellAt(row, locator.editorName),
            name,
            driveLink: cellAt(row, locator.link),
            businessUnit: sheet.businessUnit,
            sourceMonth,
            dateMade: normalizeToIsoDate(cellAt(row, locator.dateMade)),
          });
        }
      } catch (err) {
        console.error(`[driveCreatives] Skipping sheet ${sheet.sheetId} tab "${tab}" — fetch failed:`, err);
      }
    }
  }

  return rows;
}
