import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/filters";
import { getProgressData } from "@/lib/services/progressService";

export async function GET(request: NextRequest) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const data = await getProgressData(filters);
  return NextResponse.json(data);
}
