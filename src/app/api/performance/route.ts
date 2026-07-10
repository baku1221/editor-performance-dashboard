import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/filters";
import { getPerformanceData } from "@/lib/services/performanceService";

export async function GET(request: NextRequest) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const data = await getPerformanceData(filters);
  return NextResponse.json(data);
}
