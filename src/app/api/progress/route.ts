import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/filters";
import { getProgressData } from "@/lib/services/progressService";
import { IN_HOUSE_ADS_COHORT_PREFIX } from "@/lib/datasources/googleSheets/inHouseAds";

export async function GET(request: NextRequest) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const data = await getProgressData(filters);
  // The "India" cohort (Ad Tracker-India tab) and both "In House Ads *" cohorts (see
  // inHouseAds.ts) only feed the Copy Writer tab's own group views — Daily Progress tracks the
  // Ad Tracker foreign/Lumus tabs specifically, so all of them stay excluded here. The prefix
  // check covers both current In House Ads sub-cohorts (and any future one) in one line.
  return NextResponse.json(data.filter((item) => item.cohort !== "India" && !item.cohort.startsWith(IN_HOUSE_ADS_COHORT_PREFIX)));
}
