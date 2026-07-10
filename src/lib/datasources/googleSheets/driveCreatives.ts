import { config } from "../../config";
import { fetchSheetTable } from "./client";

export interface DriveCreativeRow {
  metaAdId: string;
  editorName: string;
  name: string; // ad title, as entered in this sheet
  driveLink: string; // Drive folder URL containing the source video file
}

const HEADER_ALIASES = {
  name: ["name"],
  editorName: ["editor"],
  link: ["link"],
  metaAdId: ["metaadid"],
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
 * Reads every configured "<Business> AI Creatives" sheet (see config.driveCreativeSheets).
 * Prefer joining PublishedVideo -> row by exact Meta Ad ID; fall back to
 * normalizeTitleForMatching(name) when a video's ad is a duplicate running in a different,
 * untracked campaign (same video, different ad id, title differs only by a "Copy" suffix).
 *
 * Each sheet/tab is isolated in its own try/catch — one sheet that isn't actually link-shared
 * (confirmed real case: a sheet added before its owner set "Anyone with the link can view"
 * returns an HTML login page instead of CSV) must not silently wipe out duration data for every
 * OTHER business unit's sheet too, which is what an un-isolated throw here would do.
 */
export async function fetchDriveCreativeRows(): Promise<DriveCreativeRow[]> {
  const rows: DriveCreativeRow[] = [];

  for (const sheet of config.driveCreativeSheets) {
    for (const tab of sheet.tabs) {
      try {
        const { headers, rows: dataRows } = await fetchSheetTable(sheet.sheetId, tab);
        const locator = buildColumnLocator(headers);

        for (const row of dataRows) {
          const driveLink = cellAt(row, locator.link);
          const name = cellAt(row, locator.name);
          if (!driveLink || !name) continue; // nothing to fetch duration from, or nothing to join on

          rows.push({
            metaAdId: cellAt(row, locator.metaAdId),
            editorName: cellAt(row, locator.editorName),
            name,
            driveLink,
          });
        }
      } catch (err) {
        console.error(`[driveCreatives] Skipping sheet ${sheet.sheetId} tab "${tab}" — fetch failed:`, err);
      }
    }
  }

  return rows;
}
