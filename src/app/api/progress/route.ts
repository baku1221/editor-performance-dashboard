import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/filters";
import { getProgressData } from "@/lib/services/progressService";

export async function GET(request: NextRequest) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const data = await getProgressData(filters);
  // The "India" cohort (Ad Tracker-India tab) and "In House Ads" (see inHouseAds.ts) only feed
  // the Copy Writer tab's own group views — Daily Progress tracks the Ad Tracker foreign/Lumus
  // tabs specifically, so both stay excluded here.
  return NextResponse.json(data.filter((item) => item.cohort !== "India" && item.cohort !== "In House Ads"));
}
