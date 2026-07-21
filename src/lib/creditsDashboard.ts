import Papa from "papaparse";

// Self-contained CSV schema + aggregation logic for the AI Credit Consumption
// dashboard. Deliberately independent of the rest of the app's data model —
// this widget parses and computes everything client-side, no server round trip.

export interface CreditRow {
  consumable: string;
  operatingTime: string; // "YYYY-MM-DD HH:MM:SS", kept as-is (sorts correctly as a string)
  date: string; // "YYYY-MM-DD", derived from operatingTime
  operator: string;
  credits: number;
}

export type LoadLevel = "Heavy" | "Medium" | "Light";

export interface OperatorSummary {
  operator: string;
  clips: number;
  totalCredits: number;
  pctConsumption: number;
  creditsPerClip: number;
  load: LoadLevel;
}

export interface DailySummary {
  date: string;
  clips: number;
  avgCreditsPerClip: number;
  totalCredits: number;
  pctOfGrandTotal: number;
}

export interface CreditsKpis {
  totalCredits: number;
  totalClips: number;
  avgCreditsPerClip: number;
  topConsumer: string | null;
}

export type SortKey = "totalCredits" | "clips" | "creditsPerClip";
export type SortDir = "asc" | "desc";

const HEADER_ALIASES = {
  consumable: ["consumable"],
  operatingTime: ["operatingtime"],
  operator: ["operator"],
  credits: ["countpointconsumption"],
} as const;

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Reduces a name to its first-name key for matching a credits CSV "operator" against a
 * Performance tab editor name — confirmed real case: the credits export uses login-style
 * "Firstname.lastname" operator names (e.g. "Roshan.Dubey", "Abhay.dubey"), while the editor
 * roster elsewhere is just first names ("Roshan Dubey" as one two-word name, "Abhay" alone) —
 * neither an exact string match nor a full-name match would ever line these up. Splitting on any
 * non-alphanumeric character and keeping only the first token matches on both: "roshan.dubey" and
 * "roshan dubey" both reduce to "roshan". Only safe because the current roster has no two editors
 * sharing a first name — if that ever changes, this would need a smarter (e.g. full-name) match.
 */
export function firstNameKey(name: string): string {
  return (name.trim().split(/[^a-zA-Z0-9]+/)[0] ?? "").toLowerCase();
}

export interface ParseCreditsCsvResult {
  rows: CreditRow[];
  skippedRowCount: number;
  missingColumns: string[];
}

/** Parses the "consumable, operating time, operator, count point consumption" CSV export. */
export function parseCreditsCsv(csvText: string): ParseCreditsCsvResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields ?? [];
  const normalized = headers.map((h) => ({ raw: h, normalized: normalizeHeader(h) }));

  const locate = (aliases: readonly string[]) => normalized.find((h) => aliases.includes(h.normalized))?.raw;

  const consumableCol = locate(HEADER_ALIASES.consumable);
  const operatingTimeCol = locate(HEADER_ALIASES.operatingTime);
  const operatorCol = locate(HEADER_ALIASES.operator);
  const creditsCol = locate(HEADER_ALIASES.credits);

  const missingColumns = (
    [
      ["operating time", operatingTimeCol],
      ["operator", operatorCol],
      ["count point consumption", creditsCol],
    ] as const
  )
    .filter(([, col]) => !col)
    .map(([label]) => label);

  const rows: CreditRow[] = [];
  let skippedRowCount = 0;

  parsed.data.forEach((record) => {
    const operator = operatorCol ? record[operatorCol]?.trim() : "";
    const operatingTime = operatingTimeCol ? record[operatingTimeCol]?.trim() : "";
    const creditsRaw = creditsCol ? record[creditsCol]?.trim() : "";
    const consumable = consumableCol ? record[consumableCol]?.trim() ?? "" : "";
    const credits = Number(creditsRaw);

    if (!operator || !operatingTime || !Number.isFinite(credits)) {
      skippedRowCount += 1;
      return;
    }

    rows.push({ consumable, operatingTime, date: operatingTime.slice(0, 10), operator, credits });
  });

  return { rows, skippedRowCount, missingColumns };
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function loadLevel(creditsPerClip: number, overallAvg: number): LoadLevel {
  if (overallAvg <= 0) return "Light";
  if (creditsPerClip > overallAvg * 1.3) return "Heavy";
  if (creditsPerClip < overallAvg * 0.8) return "Light";
  return "Medium";
}

export function aggregateOperators(rows: CreditRow[]): OperatorSummary[] {
  const totalCredits = rows.reduce((sum, r) => sum + r.credits, 0);
  const overallAvg = rows.length > 0 ? totalCredits / rows.length : 0;

  const byOperator = new Map<string, { clips: number; totalCredits: number }>();
  rows.forEach((r) => {
    const cur = byOperator.get(r.operator) ?? { clips: 0, totalCredits: 0 };
    cur.clips += 1;
    cur.totalCredits += r.credits;
    byOperator.set(r.operator, cur);
  });

  return Array.from(byOperator.entries()).map(([operator, agg]) => {
    const creditsPerClip = agg.clips > 0 ? agg.totalCredits / agg.clips : 0;
    return {
      operator,
      clips: agg.clips,
      totalCredits: round1(agg.totalCredits),
      pctConsumption: totalCredits > 0 ? round1((agg.totalCredits / totalCredits) * 100) : 0,
      creditsPerClip: round1(creditsPerClip),
      load: loadLevel(creditsPerClip, overallAvg),
    };
  });
}

export function sortOperators(list: OperatorSummary[], key: SortKey, dir: SortDir): OperatorSummary[] {
  const sorted = [...list].sort((a, b) => a[key] - b[key]);
  return dir === "desc" ? sorted.reverse() : sorted;
}

export function aggregateDaily(rows: CreditRow[]): DailySummary[] {
  const grandTotal = rows.reduce((sum, r) => sum + r.credits, 0);

  const byDate = new Map<string, { clips: number; totalCredits: number }>();
  rows.forEach((r) => {
    const cur = byDate.get(r.date) ?? { clips: 0, totalCredits: 0 };
    cur.clips += 1;
    cur.totalCredits += r.credits;
    byDate.set(r.date, cur);
  });

  return Array.from(byDate.entries())
    .map(([date, agg]) => ({
      date,
      clips: agg.clips,
      avgCreditsPerClip: agg.clips > 0 ? round1(agg.totalCredits / agg.clips) : 0,
      totalCredits: round1(agg.totalCredits),
      pctOfGrandTotal: grandTotal > 0 ? round1((agg.totalCredits / grandTotal) * 100) : 0,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function computeKpis(rows: CreditRow[]): CreditsKpis {
  const totalCredits = rows.reduce((sum, r) => sum + r.credits, 0);
  const totalClips = rows.length;
  const byOperator = aggregateOperators(rows);
  const top = byOperator.reduce<OperatorSummary | null>(
    (best, cur) => (!best || cur.totalCredits > best.totalCredits ? cur : best),
    null
  );

  return {
    totalCredits: round1(totalCredits),
    totalClips,
    avgCreditsPerClip: totalClips > 0 ? round1(totalCredits / totalClips) : 0,
    topConsumer: top?.operator ?? null,
  };
}

export function recentActivity(rows: CreditRow[], limit = 50): CreditRow[] {
  return [...rows].sort((a, b) => b.operatingTime.localeCompare(a.operatingTime)).slice(0, limit);
}

export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
