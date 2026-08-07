import type { DashboardFilters, ScriptWriterDetail, ScriptWriterRow } from "../types";
import { config } from "../config";
import { getProgressData } from "./progressService";
import { dateWithinFilters } from "../filters";

export type ScriptWriterGroup = "Foreign" | "India";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// "Foreign" = the original Lumus + Astrotalk Foreign cohorts combined (the Copy Writer tab's
// only group before India was added); "India" = just the Ad Tracker-India cohort.
function matchesGroup(cohort: string, group: ScriptWriterGroup): boolean {
  return group === "India" ? cohort === "India" : cohort !== "India";
}

// Only these writers show up in the Copy Writer tab — the sheet's "Script By" column also has
// pod codes and one-off contributors mixed in that shouldn't appear as if they were on the
// roster. An empty roster list means unrestricted (India has no curated list yet).
function isOnRoster(scriptWriter: string, roster: string[]): boolean {
  if (roster.length === 0) return true;
  return roster.some((name) => name.toLowerCase() === scriptWriter.toLowerCase());
}

function rosterFor(group: ScriptWriterGroup): string[] {
  return group === "India" ? config.scriptWriterRosterIndia : config.scriptWriterRoster;
}

/**
 * Scopes by `startedDate` (the sheet's Posted Date — when the script was actually written/given,
 * see ProgressItem's doc comment), not `completedDate` — a script writer's output for a period
 * should reflect when they wrote it, not whether/when an editor finished the video yet.
 */
export async function getScriptWriterData(filters: DashboardFilters, group: ScriptWriterGroup): Promise<ScriptWriterRow[]> {
  // No editor filter here — a script writer's own count shouldn't be scoped by the (unrelated)
  // editor filter in the shared FiltersBar.
  const items = (await getProgressData({ ...filters, editorName: undefined }))
    .filter((item) => dateWithinFilters(item.startedDate, filters))
    .filter((item) => matchesGroup(item.cohort, group))
    .filter((item) => isOnRoster(item.scriptWriter, rosterFor(group)));

  const byWriter = new Map<string, typeof items>();
  for (const item of items) {
    const list = byWriter.get(item.scriptWriter) ?? [];
    list.push(item);
    byWriter.set(item.scriptWriter, list);
  }

  return Array.from(byWriter.entries())
    .map(([scriptWriter, writerItems]) => {
      const winningCreatives = writerItems.filter((i) => i.matchedIsWinning).length;
      // winningPercent's own denominator is narrower than scriptsGiven: a script that's Not
      // Started/Working/Review/Delayed, or one that's Completed but never matched to a live Meta
      // ad (see progressService.ts's matchVideo — matchedIsWinning stays null until matched),
      // structurally can't be "winning" either way, so it shouldn't dilute the rate. Confirmed
      // real gap otherwise: a writer with 62 scripts but only 17 actually matched to a live ad
      // showed 6.5% (4/62) here vs the Performance tab's comparable ~25% (which only ever counts
      // ads that made it live) — same writer, same 4 wins, just a much noisier denominator.
      // scriptsGiven itself stays the full count — it's a legitimate "how much did they write"
      // metric on its own, shown as its own summary card.
      const eligible = writerItems.filter((i) => i.matchedIsWinning !== null).length;
      return {
        scriptWriter,
        scriptsGiven: writerItems.length,
        winningCreatives,
        winningPercent: eligible > 0 ? round1((winningCreatives / eligible) * 100) : 0,
      };
    })
    .sort((a, b) => b.scriptsGiven - a.scriptsGiven);
}

export async function getScriptWriterDetail(
  scriptWriter: string,
  filters: DashboardFilters,
  group: ScriptWriterGroup
): Promise<ScriptWriterDetail> {
  const items = (await getProgressData({ ...filters, editorName: undefined }))
    .filter((item) => item.scriptWriter === scriptWriter)
    .filter((item) => matchesGroup(item.cohort, group))
    .filter((item) => dateWithinFilters(item.startedDate, filters));

  return {
    scriptWriter,
    items: items.sort((a, b) => b.startedDate.localeCompare(a.startedDate)),
  };
}
