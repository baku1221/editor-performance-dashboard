import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/filters";
import { getScriptWriterDetail, type ScriptWriterGroup } from "@/lib/services/scriptWriterService";

export async function GET(request: NextRequest, { params }: { params: { name: string } }) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const scriptWriter = decodeURIComponent(params.name);
  const group: ScriptWriterGroup = request.nextUrl.searchParams.get("group") === "India" ? "India" : "Foreign";
  const detail = await getScriptWriterDetail(scriptWriter, filters, group);
  return NextResponse.json(detail);
}
