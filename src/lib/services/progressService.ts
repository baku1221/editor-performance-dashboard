import type { DashboardFilters, ProgressItem, PublishedVideo } from "../types";
import { progressRepository } from "../repositories/progressRepository";
import { publishedVideoRepository } from "../repositories/publishedVideoRepository";
import { normalizeTitleForMatching } from "../datasources/googleSheets/driveCreatives";
import { editorMatchesFilter } from "../filters";

// The Progress Tracker sheet's tab names ("Astrotalk Foreign"/"Lumus" cohorts) don't line up 1:1
// with Meta's business-unit labels ("Astrotalk"/"Lumus") — same underlying business, different
// name picked when each sheet/tab was set up. Needed to scope the match to the right account.
const COHORT_TO_BUSINESS_UNIT: Record<string, string> = {
  "Astrotalk Foreign": "Astrotalk",
  Lumus: "Lumus",
  India: "Astrotalk India",
};

function firstSegment(adName: string): string {
  return adName.split("|")[0] ?? adName;
}

/**
 * Matches a completed sheet row to the PublishedVideo(s) it became on Meta, once live there —
 * same editor, same business unit, and the ad title's first "|" segment (the concept name)
 * matches the sheet's Ad Name column. Duration still prefers the Main version specifically
 * (duration is Main-only everywhere else in this app). Winning status, though, counts the
 * script as winning if ANY version — Main or any Cut — is winning: a script that only worked
 * once a particular cut was tried is still a script that worked, not a failure just because its
 * original Main cut underperformed. All fields stay null until the sheet's "Completed" edit
 * actually goes live — there's often a lag between the two.
 */
function matchVideo(
  item: ProgressItem,
  videos: PublishedVideo[]
): { isWinning: boolean | null; durationSeconds: number | null; takenLive: boolean | null } {
  const businessUnit = COHORT_TO_BUSINESS_UNIT[item.cohort];
  const targetConcept = normalizeTitleForMatching(item.videoName);
  if (!businessUnit || !targetConcept) return { isWinning: null, durationSeconds: null, takenLive: null };

  const candidates = videos.filter(
    (v) =>
      v.businessUnit === businessUnit &&
      v.editorName === item.editorName &&
      normalizeTitleForMatching(firstSegment(v.adName)) === targetConcept
  );

  if (candidates.length === 0) return { isWinning: null, durationSeconds: null, takenLive: null };

  const main = candidates.find((v) => v.videoKind === "Main");
  return {
    isWinning: candidates.some((v) => v.isWinning),
    durationSeconds: main ? main.durationSeconds : null,
    takenLive: main ? main.takenLive : (candidates[0]?.takenLive ?? null),
  };
}

/**
 * No date filtering here on purpose. `startedDate` is the sheet's "Posted Date" — when the
 * script was written, not when the editor started work — so filtering the whole list by it
 * would (for example) hide something completed today just because its script was written
 * weeks ago. The Daily Progress UI applies date scoping itself, only to the Completed view,
 * against `completedDate` specifically — see ProgressTab's `referenceDate`.
 */
export async function getProgressData(filters: DashboardFilters): Promise<ProgressItem[]> {
  const [items, videos] = await Promise.all([progressRepository.getAll(), publishedVideoRepository.getAll()]);

  return items
    .filter((item) => editorMatchesFilter(item.editorName, filters))
    .map((item) => {
      if (item.status !== "Completed") return item; // only meaningful once actually done
      const match = matchVideo(item, videos);
      return {
        ...item,
        matchedIsWinning: match.isWinning,
        matchedDurationSeconds: match.durationSeconds,
        matchedTakenLive: match.takenLive,
      };
    })
    .sort((a, b) => a.editorName.localeCompare(b.editorName));
}
