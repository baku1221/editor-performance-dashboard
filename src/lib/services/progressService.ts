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
};

function firstSegment(adName: string): string {
  return adName.split("|")[0] ?? adName;
}

/**
 * Matches a completed sheet row to the PublishedVideo it became on Meta, once it's live there —
 * same editor, same business unit, and the ad title's first "|" segment (the concept name)
 * matches the sheet's Ad Name column. Prefers the Main version (duration is Main-only
 * everywhere else in this app); a Cut match is used only for winning status if no Main exists.
 * Both fields stay null until the sheet's "Completed" edit actually goes live — there's often a
 * lag between the two.
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

  const main = candidates.find((v) => v.videoKind === "Main");
  if (main) return { isWinning: main.isWinning, durationSeconds: main.durationSeconds, takenLive: main.takenLive };

  const any = candidates[0];
  return any
    ? { isWinning: any.isWinning, durationSeconds: null, takenLive: any.takenLive }
    : { isWinning: null, durationSeconds: null, takenLive: null };
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
