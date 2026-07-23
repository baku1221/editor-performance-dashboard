import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canViewIndiaCopywriters } from "@/lib/auth";

/** Tells the client whether to show the Copy Writer tab's India sub-tab at all — the allowlist itself stays server-side. */
export async function GET() {
  const session = await getServerSession(authOptions);
  return NextResponse.json({ canViewIndia: canViewIndiaCopywriters(session?.user?.email) });
}
