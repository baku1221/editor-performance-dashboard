import { config } from "../../config";
import { normalizeToIsoDate } from "../../dates";
import { fetchSheetTable } from "./client";

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

/** Parses a tab name like "July 2026" into "2026-07" — empty string if it doesn't match that shape. */
function parseTabMonth(tabName: string): string {
  const match = tabName.trim().toLowerCase().match(/^([a-z]+)\s+(\d{4})$/);
  if (!match) return "";
  const [, monthName, year] = match;
  const monthNumber = monthName ? MONTH_NUMBERS[monthName] : undefined;
  return monthNumber ? `${year}-${monthNumber}` : "";
}

const HEADER_ALIASES = {
  name: ["name"],
  editorName: ["editor"],
  link: ["link"],
  metaAdId: ["metaadid"],
  dateMade: ["date", "uploaddates"],
  category: ["category"],
} as const;

type Field = keyof typeof HEADER_ALIASES;

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
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

  // The Astrotalk sheet has a genuine per-row date column (real values like "01-07-26"), but its
  // header cell is blank — confirmed reliably positioned immediately after "Category" whenever
  // the header itself doesn't name it. Same "corrupted header, fall back to a known position"
  // pattern already used for the Progress Tracker sheet's Posted Date/Completed Date columns.
  // Guarded on the header actually being blank: the Astrotalk Store sheet's "Category" column is
  // immediately followed by a properly-labeled "Link" column, not a blank one — applying this
  // fallback unconditionally would misread that real column as a date.
  if (locator.dateMade === undefined && locator.category !== undefined && !normalized[locator.category + 1]) {
    locator.dateMade = locator.category + 1;
  }

  // Same story one column over on the Lumus sheet: its "Upload Dates" column is properly labeled
  // on the July tab (confirmed real values do land there on some rows), but the same column on
  // the June tab has a blank header cell — same schema, header just isn't always filled in.
  // Reliably the column immediately after "Link" when blank; guarded the same way as above so it
  // can't misfire on a sheet where Link is genuinely followed by another labeled column.
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
export function normalizeTitleForMatching(title: string): string {
  const collapsed = title
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
    for (const tab of sheet.tabs) {
      try {
        const { headers, rows: dataRows } = await fetchSheetTable(sheet.sheetId, tab);
        const locator = buildColumnLocator(headers);
        const sourceMonth = parseTabMonth(tab);

        for (const row of dataRows) {
          const name = cellAt(row, locator.name);
          if (!name) continue; // nothing to identify this as a video at all

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
