import { NextRequest, NextResponse } from "next/server";
import { creditsRepository } from "@/lib/repositories/creditsRepository";
import type { CreditRow } from "@/lib/creditsDashboard";

export async function GET() {
  const data = await creditsRepository.get();
  return NextResponse.json(data);
}

// Body is the already-parsed CSV (client parses via parseCreditsCsv before posting, same as
// before this route existed) plus the original file name — replaces whatever was stored, there's
// no history of prior uploads.
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { rows: CreditRow[]; fileName: string };
  const data = { rows: body.rows, fileName: body.fileName, uploadedAt: new Date().toISOString() };
  await creditsRepository.replace(data);
  return NextResponse.json(data);
}
