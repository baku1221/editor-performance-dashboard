import { NextResponse } from "next/server";
import { getSyncStatus, runSync } from "@/lib/services/syncService";

export async function GET() {
  return NextResponse.json(getSyncStatus());
}

export async function POST() {
  const status = await runSync();
  return NextResponse.json(status);
}
