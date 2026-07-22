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
      return {
        scriptWriter,
        scriptsGiven: writerItems.length,
        winningCreatives,
        winningPercent: writerItems.length > 0 ? round1((winningCreatives / writerItems.length) * 100) : 0,
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
