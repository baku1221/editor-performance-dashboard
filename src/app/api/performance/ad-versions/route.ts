import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/filters";
import { getAdVersions } from "@/lib/services/performanceService";

export async function GET(request: NextRequest) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const businessUnit = request.nextUrl.searchParams.get("businessUnit");
  const adId = request.nextUrl.searchParams.get("adId");
  if (!businessUnit || !adId) {
    return NextResponse.json({ error: "businessUnit and adId are required" }, { status: 400 });
  }
  const videos = await getAdVersions(businessUnit, adId, filters);
  return NextResponse.json({ videos });
}
