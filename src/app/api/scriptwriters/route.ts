import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/filters";
import { getScriptWriterData, type ScriptWriterGroup } from "@/lib/services/scriptWriterService";

export async function GET(request: NextRequest) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const group: ScriptWriterGroup = request.nextUrl.searchParams.get("group") === "India" ? "India" : "Foreign";
  const data = await getScriptWriterData(filters, group);
  return NextResponse.json(data);
}
