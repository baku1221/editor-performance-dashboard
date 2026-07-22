import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/filters";
import { getProgressData } from "@/lib/services/progressService";

export async function GET(request: NextRequest) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const data = await getProgressData(filters);
  // The "India" cohort (Ad Tracker-India tab) only feeds the Copy Writer tab's India view —
  // Daily Progress has excluded India since before that tab existed here, and still does.
  return NextResponse.json(data.filter((item) => item.cohort !== "India"));
}
