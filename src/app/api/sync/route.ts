import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isAdminEmail } from "@/lib/auth";
import { getSyncStatus, runSync } from "@/lib/services/syncService";

export async function GET() {
  return NextResponse.json(getSyncStatus());
}

/**
 * "Sync Meta" — attempts a live Meta fetch (subject to the once-per-config.metaSyncMinIntervalHours
 * floor enforced inside runSync itself; skipped attempts still refresh sheets/drive and fall back
 * to the backfill sheet for Meta enrichment). See also POST /api/sync/sheets for the
 * Meta-never-touched variant.
 *
 * Manual sync is restricted beyond just "signed in" — a sync hits Meta/Google Drive hard enough
 * to trip their rate limits (confirmed real case this session), so only one person triggering it
 * on demand keeps that risk contained. The 12-hourly auto-sync (scheduler.ts) is unaffected —
 * this only gates the manual "Sync now" button's POST.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Only an admin can trigger a manual sync." }, { status: 403 });
  }

  const status = await runSync();
  return NextResponse.json(status);
}
