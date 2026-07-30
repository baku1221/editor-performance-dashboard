import { config } from "../../config";

interface BackfillResponse {
  ok?: boolean;
  error?: string;
  updated?: number;
  appended?: number;
  total?: number;
}

/**
 * Apps Script Web Apps deliver their actual doPost response via a 302 redirect to a
 * content-addressed "echo" URL (script.googleusercontent.com/macros/echo?...) — confirmed real
 * case: letting fetch auto-follow that redirect fails to retrieve the body (Google's edge
 * appears to require the two hops be genuinely separate requests, not a single client-driven
 * follow). Redirects are followed manually here: POST first, then a plain GET on whatever
 * Location header comes back.
 */
async function postToAppsScript(url: string, body: unknown): Promise<BackfillResponse> {
  const firstRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
  });

  const location = firstRes.headers.get("location");
  if (!location) {
    return (await firstRes.json()) as BackfillResponse;
  }

  const secondRes = await fetch(location);
  return (await secondRes.json()) as BackfillResponse;
}

export function isSheetBackfillConfigured(): boolean {
  return Boolean(config.sheetBackfill.webhookUrl && config.sheetBackfill.secret);
}

/**
 * Writes one business unit's rows to its tab in the backfill sheet — the Apps Script
 * (doPost) does the actual "append + update in place" merge, keyed by each row's own first
 * column (Ad ID), so this is safe to call every sync with the full current row set.
 */
export async function backfillBusinessUnitRows(
  businessUnit: string,
  headers: string[],
  rows: Array<Array<string | number>>
): Promise<void> {
  if (!isSheetBackfillConfigured()) return;

  const result = await postToAppsScript(config.sheetBackfill.webhookUrl, {
    secret: config.sheetBackfill.secret,
    businessUnit,
    headers,
    rows,
  });

  if (!result.ok) {
    throw new Error(result.error ?? "Unknown sheet-backfill error");
  }
}
