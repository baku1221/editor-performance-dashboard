import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/filters";
import { getScriptWriterData } from "@/lib/services/scriptWriterService";

export async function GET(request: NextRequest) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const data = await getScriptWriterData(filters);
  return NextResponse.json(data);
}
