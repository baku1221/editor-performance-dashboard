import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isAdminEmail } from "@/lib/auth";
import { runSync } from "@/lib/services/syncService";

/**
 * "Sync Sheets" — refreshes Google Sheets (Progress Tracker + every "<Business> AI Creatives"
 * sheet) and Drive durations, but never touches Meta at all this call, regardless of whether
 * config.metaSyncMinIntervalHours has elapsed. Meta enrichment for already-live videos comes
 * from the backfill sheet's last-known data instead (see syncService.ts's runSync). Use this to
 * pick up newly-added script rows/editors without any Meta rate-limit risk; use POST /api/sync
 * ("Sync Meta") when you actually need fresh live-ad data.
 *
 * Same admin restriction as /api/sync — see that route's doc comment.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Only an admin can trigger a manual sync." }, { status: 403 });
  }

  const status = await runSync({ skipMeta: true });
  return NextResponse.json(status);
}
