import Papa from "papaparse";
import { google } from "googleapis";
import { config } from "../../config";

export interface SheetTable {
  headers: string[];
  rows: string[][];
}

/**
 * A link-shared sheet ("Anyone with the link can view") is readable as plain
 * CSV via Google's public gviz export — no API key or service account
 * needed. This is the zero-config default. If credentials are set (for a
 * restricted sheet later), the authenticated Sheets API path is used
 * instead — see fetchViaAuthenticatedApi below.
 */
async function fetchViaPublicCsvExport(sheetId: string, tabName: string): Promise<SheetTable> {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
  url.searchParams.set("tqx", "out:csv");
  url.searchParams.set("sheet", tabName);
  // Without this, gviz auto-detects how many header rows exist — and its heuristic can badly
  // misfire: confirmed on real sheets in this org, it sometimes decides row 1 isn't a real
  // header and instead synthesizes one by concatenating dozens of real data rows' values into
  // a single garbled "header" cell per column, silently swallowing that data from the export
  // entirely. headers=0 tells it definitively "don't guess, there is no header row" — we already
  // slice row 1 off ourselves below, so this can't lose data either way.
  url.searchParams.set("headers", "0");

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
