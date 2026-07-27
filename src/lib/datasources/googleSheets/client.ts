import Papa from "papaparse";
import { google } from "googleapis";
import { config } from "../../config";

export interface SheetTable {
  headers: string[];
  rows: string[][];
}

// sheetId -> (tab name -> gid). Populated once per sheet per process lifetime — the tab-name-to-
// gid mapping essentially never changes, so there's no need to re-fetch it on every sync.
const gidCacheBySheet = new Map<string, Map<string, string>>();

/**
 * Scrapes the sheet's own htmlview page for its tab-name-to-gid mapping — there's no documented,
 * unauthenticated endpoint for this, but every Sheets htmlview page embeds a JS array of
 * `{name, pageUrl (containing "gid=<id>")}` entries for its tab switcher, which is stable enough
 * to rely on in practice.
 */
async function fetchGidMap(sheetId: string): Promise<Map<string, string>> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`);
  const html = await res.text();
  const map = new Map<string, string>();
  for (const match of html.matchAll(/name: "([^"]+)", pageUrl:.*?gid=(-?\d+)/g)) {
    const name = match[1];
    const gid = match[2];
    if (name && gid) map.set(name, gid);
  }
  return map;
}

async function resolveGid(sheetId: string, tabName: string): Promise<string | undefined> {
  let gids = gidCacheBySheet.get(sheetId);
  if (!gids) {
    gids = await fetchGidMap(sheetId);
    gidCacheBySheet.set(sheetId, gids);
  }
  return gids.get(tabName);
}

/**
 * A link-shared sheet ("Anyone with the link can view") is readable as plain
 * CSV via Google's public export endpoint — no API key or service account
 * needed. This is the zero-config default. If credentials are set (for a
 * restricted sheet later), the authenticated Sheets API path is used
 * instead — see fetchViaAuthenticatedApi below.
 *
 * Uses /export?format=csv rather than the gviz/tq endpoint this used to call — confirmed real
 * case: gviz's cache got stuck on stale data for 30+ minutes after a live edit (re-typing the
 * same cell twice didn't help), while /export reflected edits immediately every time it was
 * checked. /export also sidesteps two gviz-specific quirks entirely: its header-row heuristic
 * that sometimes fuses a header label onto the first data row's value (previously worked around
 * with a substring-match column locator — see driveCreatives.ts) and the blank "Posted
 * Date"/"Idea Num" headers gviz produced for the Progress Tracker sheet (previously worked around
 * with positional fallbacks — see buildColumnLocator in progressTracker.ts). Both sets of
 * workarounds are left in place since they're harmless no-ops against clean headers, not removed
 * here to keep this fix scoped to just the fetch mechanism.
 *
 * Resolves the tab name to its gid first and always fetches by `gid=`, never by `sheet=<name>` —
 * confirmed real case on the Progress Tracker sheet: /export's own name-based lookup silently
 * returned the SAME tab's content for both "Ad Tracker-foreign(AT)" and "...(LUMUS)" (identical
 * rows, same "Astrotalk" platform value for what should have been the distinct Lumus tab) — the
 * exact "wrong/ambiguous sheet wins silently" failure mode this app has already hit with gviz
 * elsewhere, just triggered by a different endpoint. gid-based lookup doesn't have this ambiguity
 * since a gid is unique per tab. Falls back to `sheet=<name>` only if gid resolution itself fails
 * (e.g. the htmlview scrape breaks), which is no worse than this function's old behavior.
 */
async function fetchViaPublicCsvExport(sheetId: string, tabName: string): Promise<SheetTable> {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/export`);
  url.searchParams.set("format", "csv");

  const gid = await resolveGid(sheetId, tabName).catch(() => undefined);
  if (gid) {
    url.searchParams.set("gid", gid);
  } else {
    url.searchParams.set("sheet", tabName);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(
      `Could not read tab "${tabName}" (HTTP ${res.status}). The sheet may not be shared as ` +
        `"Anyone with the link can view", or the tab name may be wrong.`
    );
  }

  const csvText = await res.text();
  const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: true });
  const [headerRow, ...dataRows] = parsed.data;

  return {
    headers: (headerRow ?? []).map((cell) => String(cell ?? "").trim()),
    rows: dataRows.map((row) => row.map((cell) => String(cell ?? "").trim())),
  };
}

let sheetsClient: ReturnType<typeof google.sheets> | null = null;

function getAuthenticatedSheetsClient() {
  if (!sheetsClient) {
    const auth = config.googleSheets.apiKey
      ? config.googleSheets.apiKey
      : new google.auth.JWT({
          email: config.googleSheets.clientEmail,
          key: config.googleSheets.privateKey,
          scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
        });
    sheetsClient = google.sheets({ version: "v4", auth });
  }
  return sheetsClient;
}

async function fetchViaAuthenticatedApi(sheetId: string, tabName: string): Promise<SheetTable> {
  const sheets = getAuthenticatedSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!A1:Z1000`,
  });

  const rows = res.data.values ?? [];
  if (rows.length === 0) return { headers: [], rows: [] };

  const [headerRow, ...dataRows] = rows;
  return {
    headers: (headerRow ?? []).map((cell) => String(cell ?? "").trim()),
    rows: dataRows.map((row) => row.map((cell) => String(cell ?? "").trim())),
  };
}

/**
 * Fetches a whole tab and splits it into a header row + data rows. Real
 * sheets in this org don't share one fixed column layout across tabs (extra
 * columns, renamed columns), so callers locate fields by header name rather
 * than by fixed position — see buildColumnLocator in progressTracker.ts.
 */
export async function fetchSheetTable(sheetId: string, tabName: string): Promise<SheetTable> {
  const hasCredentials = Boolean(config.googleSheets.apiKey || (config.googleSheets.clientEmail && config.googleSheets.privateKey));
  return hasCredentials ? fetchViaAuthenticatedApi(sheetId, tabName) : fetchViaPublicCsvExport(sheetId, tabName);
}
