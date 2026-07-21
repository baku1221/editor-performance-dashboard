import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/filters";
import { getScriptWriterDetail } from "@/lib/services/scriptWriterService";

export async function GET(request: NextRequest, { params }: { params: { name: string } }) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const scriptWriter = decodeURIComponent(params.name);
  const detail = await getScriptWriterDetail(scriptWriter, filters);
  return NextResponse.json(detail);
}
