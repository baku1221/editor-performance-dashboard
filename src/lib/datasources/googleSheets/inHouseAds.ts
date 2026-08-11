import type { ProgressItem } from "../../types";
import { config, type EditorRosterEntry } from "../../config";
import { normalizeToIsoDate } from "../../dates";
import { normalizeEditorName } from "../../services/editorTitleParser";
import { EMPTY_IN_HOUSE_ADS_WINNING_INDEX, type InHouseAdsWinningIndex } from "../metaAds/inHouseAdsWinning";
import { fetchSheetTable } from "./client";
import { normalizeTitleForMatching, parseTabMonth, withCurrentMonthTab } from "./driveCreatives";

// The cohort prefix used throughout the app (ProgressItem.cohort, the Copy Writer tab's group
// selector, the Daily Progress exclusion filter) for every row sourced from config.inHouseAdsSheets
// — see cohortForRegion below for how a row's own Region cell picks the specific "In House Ads
// <Label>" cohort.
export const IN_HOUSE_ADS_COHORT_PREFIX = "In House Ads";

// Each sheet's own Region column is one clean value across every row (confirmed real data: sheet
// 1 is 100% "Lumus", sheet 2 is 100% "Angrez") — "Angrez" (Hindi/Urdu for "English"/foreign) is
// this team's own name for what's labeled "Astrotalk" everywhere else in this app (same "Astrotalk
// Foreign" business unit the Performance tab tracks). Read from the row's own Region cell rather
// than assumed per-sheet, so this still resolves correctly if a sheet ever mixes regions.
const REGION_TO_LABEL: Record<string, string> = {
  lumus: "Lumus",
  angrez: "Astrotalk",
};

/** The bare region label ("Lumus"/"Astrotalk") — also config.inHouseAdsWinningRule's own keys,
 * so a row's winning check (see matchedIsWinningFor) looks up the same region this resolves to. */
function regionLabelFor(region: string): string | undefined {
  return REGION_TO_LABEL[region.trim().toLowerCase()];
}

function cohortForRegion(region: string): string {
  const label = regionLabelFor(region);
  // Falls back to the bare prefix (not one of the two known sub-cohorts) for any future/unmapped
  // region value — still excluded from Daily Progress and from Foreign/India (see matchesGroup's
  // prefix check), just won't show up under either Astrotalk/Lumus sub-tab until mapped here.
  return label ? `${IN_HOUSE_ADS_COHORT_PREFIX} ${label}` : IN_HOUSE_ADS_COHORT_PREFIX;
}

interface InHouseAdsMetaMatch {
  // true if a duplicate of this row's own title (by normalized text, same
  // normalizeTitleForMatching used everywhere else) was found in the region's SCALING
  // account/campaigns (see config.inHouseAdsWinningRule) — the actual winning signal. false if it
  // was found in the TESTING side but never made it to scaling — tested, just not (yet) a winner.
  // null if it wasn't found in either at all — never even tested on Meta, so (same "eligible"
  // principle as scriptWriterService.ts's Completed-and-matched denominator for the other Copy
  // Writer groups) this shouldn't count against the writer's winning % either way.
  isWinning: boolean | null;
  // When this concept was first created in the region's testing campaign — null alongside
  // isWinning=null (never found at all).
  testedDate: string | null;
  // When it was first created in the SCALING account/campaign — null unless isWinning is true.
  scaledDate: string | null;
}

function matchInHouseAdsMeta(name: string, region: string | undefined, winningIndex: InHouseAdsWinningIndex): InHouseAdsMetaMatch {
  if (!region) return { isWinning: null, testedDate: null, scaledDate: null };

  const key = normalizeTitleForMatching(name);
  const testedDate = winningIndex.testedDates[region]?.get(key) ?? null;
  const scaledDate = winningIndex.scaledDates[region]?.get(key) ?? null;

  if (winningIndex.winningTitles[region]?.has(key)) return { isWinning: true, testedDate, scaledDate };
  if (winningIndex.testedTitles[region]?.has(key)) return { isWinning: false, testedDate, scaledDate: null };
  return { isWinning: null, testedDate: null, scaledDate: null };
}

const HEADER_ALIASES = {
  name: ["name"],
  editorName: ["editor"],
  uploadDates: ["uploaddates"],
  region: ["region"],
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
 * Writer tab's "In House Ads" sub-tabs — split into "In House Ads Lumus"/"In House Ads Astrotalk"
 * by each row's own Region cell (see cohortForRegion), not by which of the two sheets it came
 * from, so this still resolves correctly if a sheet ever mixes regions. Every logged row already
 * has a finished caption/heading, so (unlike the Ad Tracker sheets, which track a script through
 * Not Started -> ... -> Completed) there's no meaningful in-progress state here — every row is
 * treated as Completed. Static rows count same as Video ones (deliberately NOT filtered like
 * driveCreatives.ts does) — writing the copy for a static ad is still copywriting work, even
 * though this app doesn't track static editors' video performance.
 *
 * matchedIsWinning/matchedTestedDate/matchedScaledDate are resolved against `winningIndex` (see
 * inHouseAdsWinning.ts and matchInHouseAdsMeta above) — a completely separate check from
 * progressService.ts's PublishedVideo-based matching used by every other Copy Writer group
 * (there's still no COHORT_TO_BUSINESS_UNIT entry for either In House Ads cohort, so that path
 * never fires here). matchedDurationSeconds/matchedTakenLive stay null regardless — the winning
 * check doesn't fetch duration or live-status, only ad identity + created_time, and nothing else
 * in this app needs those two fields for this cohort.
 *
 * Each sheet+tab is isolated in its own try/catch, same resilience principle as
 * fetchDriveCreativeRows — one sheet not actually being link-shared, or a renamed/missing tab,
 * must not wipe out the other sheet's rows or (via fetchProgressTracker, which calls this) the
 * Ad Tracker sheet's own successful fetch.
 */
export async function fetchInHouseAdsProgress(
  roster: EditorRosterEntry[] = config.editorRoster,
  winningIndex: InHouseAdsWinningIndex = EMPTY_IN_HOUSE_ADS_WINNING_INDEX
): Promise<ProgressItem[]> {
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
            const region = regionLabelFor(cellAt(row, locator.region));
            const metaMatch = matchInHouseAdsMeta(name, region, winningIndex);

            items.push({
              id: `inhouse:${sheet.sheetId}:${tab}::${index}`,
              editorName: editorNameRaw ? (normalizeEditorName(editorNameRaw, roster) ?? editorNameRaw) : "Unassigned",
              scriptWriter: scriptWriterRaw,
              videoName: name,
              currentStage: "Completed",
              status: "Completed",
              startedDate: normalizeUploadDate(cellAt(row, locator.uploadDates), sourceMonth),
              completedDate: normalizeUploadDate(cellAt(row, locator.uploadDates), sourceMonth),
              cohort: cohortForRegion(cellAt(row, locator.region)),
              matchedIsWinning: metaMatch.isWinning,
              matchedDurationSeconds: null,
              matchedTakenLive: null,
              matchedTestedDate: metaMatch.testedDate,
              matchedScaledDate: metaMatch.scaledDate,
            });
          });
      } catch (err) {
        console.error(`[inHouseAds] Skipping sheet ${sheet.sheetId} tab "${tab}" — fetch failed:`, err);
      }
    }
  }

  return items;
}
