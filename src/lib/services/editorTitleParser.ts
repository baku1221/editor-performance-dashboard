import type { EditorRosterEntry } from "../config";

// Extracts the editor's name directly from a Meta ad title, per this naming
// convention (confirmed against a real example):
//
//   "party on boat | V1 - Main | Parul - SYAT - Samridhi-PPP"
//                                 ^^^^^ editor name
//
// The editor is the first " - "-delimited token of the LAST "|"-delimited
// segment. Titles that don't have at least one "|" and one " - " in that
// last segment don't match the convention and are left unattributed rather
// than guessed at.
//
// The Lumus account's titles use an en dash ("–") instead of a hyphen
// ("-") as the same separator (e.g. "abhi – SYAT PPP – Copy") — both are
// accepted so this doesn't silently glob the whole segment into one token.
const DASH_SEPARATOR = /\s[-–]\s/;

export function parseEditorFromAdTitle(adTitle: string): string | null {
  const segments = adTitle
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  const lastSegment = segments[segments.length - 1];
  if (!lastSegment) return null;

  const token = lastSegment.split(DASH_SEPARATOR)[0]?.trim();
  return token || null;
}

/**
 * The middle "|"-delimited segment (e.g. "V1 - Main", "V2 - Cut 1") identifies
 * whether an ad is the primary edit or a shorter derivative cut. Only read
 * when there are at least 3 segments — with just 2, that middle segment
 * doesn't exist and segments[1] would actually be the editor segment.
 */
export function parseVideoKindFromAdTitle(adTitle: string): "Main" | "Cut" | null {
  const segments = adTitle
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length < 3) return null;

  const stageSegment = segments[1]?.toLowerCase() ?? "";
  if (stageSegment.includes("main")) return "Main";
  if (stageSegment.includes("cut")) return "Cut";
  return null;
}

const CUT_MENTION = /\bcuts?\b/i;

/**
 * Fallback for titles that don't have the "V1 - Main | V2 - Cut 1" middle-segment convention
 * above — confirmed on the Astrotalk Store account, whose titles instead just start with a
 * "hookline" concept name: an untagged hookline (no "cut" mentioned anywhere in the title) is
 * the Main/original version, and a cut is always explicitly marked "cut", "cut1", "cut 2", etc.
 * somewhere in the title. Only used when the primary convention above finds nothing, so it
 * never changes titles that already parse correctly. Unlike the primary parser this always
 * resolves to Main or Cut, never null — absence of "cut" is itself the Main signal here.
 */
export function matchVideoKindByCutMention(adTitle: string): "Main" | "Cut" {
  return CUT_MENTION.test(adTitle) ? "Cut" : "Main";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Once a roster of canonical editor names is configured (EDITOR_ROSTER in
 * .env.local), normalize a raw editor name (from a Meta ad title OR the
 * Progress Tracker sheet's Editor column) against it — case/whitespace
 * differences collapse to one canonical name, and a roster first-name
 * ("Abhay") matches a fuller sheet entry ("Abhay dubey").
 *
 * Strict on purpose: real ad titles carry pod/team codes in the same slot as
 * the editor name (e.g. "Arat", "ART", "SYAT" are pod codes, not editors),
 * and casing/spelling drift ("sutiskhan" vs "Sutikshan") would otherwise each
 * become their own fake "editor". With a roster configured, ANYTHING that
 * doesn't match a roster name — pod code, typo, unrecognized name — returns
 * null (grouped under "Unmapped" upstream) rather than being invented as a
 * new editor bucket. Without a roster configured at all, the raw name is
 * used as-is since there's nothing to validate against yet.
 */
export function normalizeEditorName(rawName: string | null, roster: EditorRosterEntry[]): string | null {
  if (!rawName) return null;
  if (roster.length === 0) return rawName;

  const lower = rawName.toLowerCase();

  const exactMatch = roster.find((entry) => entry.aliases.some((alias) => alias.toLowerCase() === lower));
  if (exactMatch) return exactMatch.canonical;

  // Whole-word match anywhere in the raw name — catches "Yash raj singh" / "Anil prajapat"
  // (roster name + surname) without accidentally matching a roster name as a substring of
  // an unrelated longer word.
  const wordMatch = roster.find((entry) =>
    entry.aliases.some((alias) => new RegExp(`\\b${escapeRegExp(alias.toLowerCase())}\\b`).test(lower))
  );
  return wordMatch?.canonical ?? null;
}

/**
 * Fallback for ad titles that don't follow the "last segment / first dash token" convention
 * above — confirmed on the Astrotalk Store account (act_2158343221618433), whose titles instead
 * carry the editor as a bare "|"-delimited segment with no dash, at a position that shifts
 * depending on how many pod/campaign code segments follow it, e.g.:
 *
 *   "Makar rashi waale dhyan se suno | BRC | SUKH | Aman | KGAT | PPP – Copy"
 *   "iski rashi mesh cuts 2 | ZDCT | BRC | deep | KGAT | PPP – Copy"
 *
 * Since position isn't reliable here, this scans every segment for an exact (case-insensitive)
 * roster match instead. A few titles on this account carry two roster names in one title (e.g.
 * a writer credit alongside the editor) — every confirmed example has the real editor in the
 * segment closest to the end, so the rightmost match wins on ties. Only called when the primary
 * convention above finds no roster match, so it never changes attribution for titles that
 * already parse correctly.
 */
export function matchEditorBySegmentScan(adTitle: string, roster: EditorRosterEntry[]): string | null {
  if (roster.length === 0) return null;

  const segments = adTitle
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  let found: string | null = null;
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    const match = roster.find((entry) => entry.aliases.some((alias) => alias.toLowerCase() === lower));
    if (match) found = match.canonical;
  }

  return found;
}
