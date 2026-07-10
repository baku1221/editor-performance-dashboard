import type { ProgressItem, ProgressStatus } from "../../types";
import { config } from "../../config";
import { normalizeToIsoDate } from "../../dates";
import { normalizeEditorName } from "../../services/editorTitleParser";
import { fetchSheetTable } from "./client";

// Real tabs don't share one fixed column layout (extra/renamed columns), so
// fields are located by normalized header name rather than fixed position.
const HEADER_ALIASES = {
  postedDate: ["posteddate"],
  adName: ["adname"],
  status: ["status"],
  editorName: ["editor"],
  // "Completed Date" (India tab) and "Date" (Foreign/Lumus tabs) occupy the same logical slot.
  // Note: the sheet's "Date done" column holds free-text labels (e.g. "All AI Concepts"), not
  // dates, in real data — deliberately not treated as a date field here.
  completedDate: ["completeddate", "date"],
} as const;

type Field = keyof typeof HEADER_ALIASES;

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildColumnLocator(headers: string[]): Partial<Record<Field, number>> {
  const normalized = headers.map(normalizeHeader);
  const locator: Partial<Record<Field, number>> = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[Field, readonly string[]]>) {
    const index = normalized.findIndex((h) => (aliases as string[]).includes(h));
    if (index !== -1) locator[field] = index;
  }

  // The Foreign/Lumus tabs' first column header is corrupted in the real sheet (renders as "]"
  // instead of "Posted Date") — but it's reliably column 0 in every tab seen, so fall back to
  // position when no header matched.
  if (locator.postedDate === undefined && headers.length > 0) {
    locator.postedDate = 0;
  }

  // Same story one column over: the actual completion-date column has no header text at all in
  // both Foreign/Lumus tabs (confirmed against real data — it holds real dates like "23/4/26",
  // always the column immediately after Editor), so "completeddate"/"date" never matches it by
  // name. Falls back to editorIndex + 1 when nothing matched by header.
  if (locator.completedDate === undefined && locator.editorName !== undefined) {
    locator.completedDate = locator.editorName + 1;
  }

  return locator;
}

function normalizeStatus(raw: string): ProgressStatus {
  const value = raw.toLowerCase().trim();
  if (value.includes("not started") || value === "") return "Not Started";
  if (value.includes("complete")) return "Completed";
  if (value.includes("delay")) return "Delayed";
  if (value.includes("review")) return "Review";
  if (value.includes("progress")) return "Working";
  return "Not Started";
}

function cellAt(row: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return row[index] ?? "";
}

/** Fetches + merges the configured progress-tracker tabs (see config.googleSheets.progressTracker.tabs). */
export async function fetchProgressTracker(): Promise<ProgressItem[]> {
  const { sheetId, tabs } = config.googleSheets.progressTracker;
  if (!sheetId) {
    throw new Error("PROGRESS_TRACKER_SHEET_ID is not set in .env.local");
  }
  if (tabs.length === 0) {
    throw new Error("PROGRESS_TRACKER_TABS has no tabs configured.");
  }

  const items: ProgressItem[] = [];

  for (const tab of tabs) {
    const { headers, rows } = await fetchSheetTable(sheetId, tab.name);
    const locator = buildColumnLocator(headers);

    rows
      .filter((row) => row.some((cell) => cell.length > 0))
      .forEach((row, index) => {
        const editorNameCell = cellAt(row, locator.editorName).trim();
        // The sheet uses the literal text "none" (not just a blank cell) for unassigned rows.
        const editorNameRaw = editorNameCell.toLowerCase() === "none" ? "" : editorNameCell;
        const statusRaw = cellAt(row, locator.status).trim();
        const completedDateRaw = cellAt(row, locator.completedDate).trim();

        items.push({
          id: `${tab.name}::${index}`,
          editorName: editorNameRaw ? (normalizeEditorName(editorNameRaw, config.editorRoster) ?? editorNameRaw) : "Unassigned",
          videoName: cellAt(row, locator.adName).trim(),
          currentStage: statusRaw,
          status: normalizeStatus(statusRaw),
          startedDate: normalizeToIsoDate(cellAt(row, locator.postedDate).trim()),
          completedDate: completedDateRaw ? normalizeToIsoDate(completedDateRaw) : "",
          cohort: tab.cohort,
          // Filled in later by progressService, once it's matched against PublishedVideo.
          matchedIsWinning: null,
          matchedDurationSeconds: null,
        });
      });
  }

  return items;
}
