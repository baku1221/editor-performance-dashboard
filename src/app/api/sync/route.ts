import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isAdminEmail } from "@/lib/auth";
import { getSyncStatus, runSync } from "@/lib/services/syncService";

export async function GET() {
  return NextResponse.json(getSyncStatus());
}

/**
 * "Sync Meta" — always attempts a live Meta fetch, bypassing config.metaSyncMinIntervalHours (see
 * runSync's forceMeta option). A deliberate manual click means "I want fresh data now" — unlike
 * the automatic scheduler triggers, where that floor exists specifically to avoid hammering Meta's
 * rate limit on an unattended schedule. See also POST /api/sync/sheets for the Meta-never-touched
 * variant, and config.metaSyncDaily for the deterministic once-daily automatic live sync.
 *
 * Manual sync is restricted beyond just "signed in" — a sync hits Meta/Google Drive hard enough
 * to trip their rate limits (confirmed real case this session), so only one person triggering it
 * on demand keeps that risk contained. The automatic scheduler triggers (scheduler.ts) are
 * unaffected — this only gates the manual "Sync Meta" button's POST.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Only an admin can trigger a manual sync." }, { status: 403 });
  }

  const status = await runSync({ forceMeta: true });
  return NextResponse.json(status);
}
