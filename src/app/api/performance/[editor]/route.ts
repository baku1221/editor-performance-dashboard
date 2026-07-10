import { NextRequest, NextResponse } from "next/server";
import { parseDashboardFilters } from "@/lib/filters";
import { getEditorDetail } from "@/lib/services/performanceService";

export async function GET(request: NextRequest, { params }: { params: { editor: string } }) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const editorName = decodeURIComponent(params.editor);
  const businessUnit = request.nextUrl.searchParams.get("businessUnit") ?? undefined;
  const detail = await getEditorDetail(editorName, filters, businessUnit);
  return NextResponse.json(detail);
}
