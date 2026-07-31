import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/filters";
import { getMainAdsDetail } from "@/lib/services/performanceService";

export async function GET(request: NextRequest) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const businessUnit = request.nextUrl.searchParams.get("businessUnit");
  if (!businessUnit) {
    return NextResponse.json({ error: "businessUnit is required" }, { status: 400 });
  }
  const detail = await getMainAdsDetail(businessUnit, filters);
  return NextResponse.json(detail);
}
