import type { ProgressItem } from "../../types";
import { config, type EditorRosterEntry } from "../../config";
import { normalizeToIsoDate } from "../../dates";
import { normalizeEditorName } from "../../services/editorTitleParser";
import { fetchSheetTable } from "./client";
import { parseTabMonth, withCurrentMonthTab } from "./driveCreatives";

// The cohort label used throughout the app (ProgressItem.cohort, the Copy Writer tab's group
// selector) for rows sourced from config.inHouseAdsSheets.
export const IN_HOUSE_ADS_COHORT = "In House Ads";

const HEADER_ALIASES = {
  name: ["name"],
  editorName: ["editor"],
  uploadDates: ["uploaddates"],
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

  return locator;
}

function cellAt(row: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return (row[index] ?? "").trim();
}

/**
 * These sheets have no dedicated copywriter column at all (unlike the Ad Tracker sheets' "Script
 * By") — the name is embedded in the free-text Name column instead, in several different
 * conventions confirmed across real rows: a trailing "[Name]" bracket, a "{name}" brace (sometimes
 * with the editor's name alongside it, e.g. "{ankit samridhi}"), a "(Name)" paren, a "- Name"
 * dash suffix, or just a bare name fragment buried in an underscore-joined slug (e.g.
 * "..._shreya_m_07"). Rather than special-case each convention, this scans the whole string for
 * every roster name as a letter-bounded match (so "shreya" inside "..._shreya_m_07" matches, but a
 * roster name that happened to be a substring of some unrelated longer word wouldn't) and takes
 * the RIGHTMOST match — confirmed necessary against a real row like
 * "long_commitment_user_psychic_ai_moksh_v2_ridhima_06", where "moksh" (the video editor, whose
 * name is also on the roster) appears earlier in the slug than "ridhima" (the actual copywriter,
 * at the very end) — taking the first match would have misattributed it.
 */
export function parseCopywriterFromName(name: string, roster: string[]): string {
  let best: { writer: string; index: number } | null = null;

  for (const writer of roster) {
    const pattern = new RegExp(`(?<![a-zA-Z])${writer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-zA-Z])`, "gi");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(name)) !== null) {
      if (!best || match.index > best.index) {
        best = { writer, index: match.index };
      }
    }
  }

  return best?.writer ?? "Unassigned";
}

/**
 * "Upload Dates" cells carry day/month only, no year ("03/08", "1/7") — normalizeToIsoDate alone
 * can't place these on a calendar since every one of its delimited formats expects a year. The
 * year comes from the tab itself instead (a "August 2026"-style tab name), while the day/month
 * stays the row's own — confirmed the right way round elsewhere in this app (see
 * driveCreatives.ts): a row's own date is always preferred over the tab's, this cell just happens
 * to be missing the one piece (year) only the tab can supply.
 */
function normalizeUploadDate(raw: string, sourceMonth: string): string {
  const trimmed = raw.trim();
  const fallback = sourceMonth ? `${sourceMonth}-01` : "";
  if (!trimmed) return fallback;

  const dayMonthOnly = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (dayMonthOnly && sourceMonth) {
    const [, day, month] = dayMonthOnly;
    const year = sourceMonth.slice(0, 4);
    return `${year}-${(month ?? "").padStart(2, "0")}-${(day ?? "").padStart(2, "0")}`;
  }

  return normalizeToIsoDate(trimmed) || fallback;
}

/**
 * Reads config.inHouseAdsSheets (see its doc comment) into ProgressItem-shaped rows for the Copy
 * Writer tab's "In House Ads" group. Every logged row already has a finished caption/heading, so
 * (unlike the Ad Tracker sheets, which track a script through Not Started -> ... -> Completed)
 * there's no meaningful in-progress state here — every row is treated as Completed. Static rows
 * count same as Video ones (deliberately NOT filtered like driveCreatives.ts does) — writing the
 * copy for a static ad is still copywriting work, even though this app doesn't track static
 * editors' video performance.
 *
 * matchedIsWinning/matchedDurationSeconds/matchedTakenLive stay null forever for this cohort —
 * there's no COHORT_TO_BUSINESS_UNIT entry for "In House Ads" (see progressService.ts), so
 * getProgressData's matching never has a business unit to match against. That's intentional, not
 * a bug: neither sheet has CPI/spend data, and their Meta ad account isn't onboarded into the
 * sync, so there's no live data to determine "winning" from yet.
 *
 * Each sheet+tab is isolated in its own try/catch, same resilience principle as
 * fetchDriveCreativeRows — one sheet not actually being link-shared, or a renamed/missing tab,
 * must not wipe out the other sheet's rows or (via fetchProgressTracker, which calls this) the
 * Ad Tracker sheet's own successful fetch.
 */
export async function fetchInHouseAdsProgress(roster: EditorRosterEntry[] = config.editorRoster): Promise<ProgressItem[]> {
  const items: ProgressItem[] = [];

  for (const sheet of config.inHouseAdsSheets) {
    for (const tab of withCurrentMonthTab(sheet.tabs)) {
      try {
        const { headers, rows } = await fetchSheetTable(sheet.sheetId, tab);
        const locator = buildColumnLocator(headers);
        const sourceMonth = parseTabMonth(tab);

        rows
          .filter((row) => row.some((cell) => cell.length > 0))
          .forEach((row, index) => {
            const name = cellAt(row, locator.name);
            if (!name) return; // nothing to attribute or count

            const editorNameRaw = cellAt(row, locator.editorName);
            const scriptWriterRaw = parseCopywriterFromName(name, config.scriptWriterRoster);

            items.push({
              id: `inhouse:${sheet.sheetId}:${tab}::${index}`,
              editorName: editorNameRaw ? (normalizeEditorName(editorNameRaw, roster) ?? editorNameRaw) : "Unassigned",
              scriptWriter: scriptWriterRaw,
              videoName: name,
              currentStage: "Completed",
              status: "Completed",
              startedDate: normalizeUploadDate(cellAt(row, locator.uploadDates), sourceMonth),
              completedDate: normalizeUploadDate(cellAt(row, locator.uploadDates), sourceMonth),
              cohort: IN_HOUSE_ADS_COHORT,
              matchedIsWinning: null,
              matchedDurationSeconds: null,
              matchedTakenLive: null,
            });
          });
      } catch (err) {
        console.error(`[inHouseAds] Skipping sheet ${sheet.sheetId} tab "${tab}" — fetch failed:`, err);
      }
    }
  }

  return items;
}
