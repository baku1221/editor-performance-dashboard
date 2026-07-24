import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canViewAvniRow } from "@/lib/auth";
import { parseDashboardFilters } from "@/lib/filters";
import { getScriptWriterDetail, type ScriptWriterGroup } from "@/lib/services/scriptWriterService";

export async function GET(request: NextRequest, { params }: { params: { name: string } }) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const scriptWriter = decodeURIComponent(params.name);
  const group: ScriptWriterGroup = request.nextUrl.searchParams.get("group") === "India" ? "India" : "Foreign";

  if (group === "India" && scriptWriter.toLowerCase() === "avni") {
    const session = await getServerSession(authOptions);
    if (!canViewAvniRow(session?.user?.email)) {
      return NextResponse.json({ error: "Not authorized to view this script writer." }, { status: 403 });
    }
  }

  const detail = await getScriptWriterDetail(scriptWriter, filters, group);
  return NextResponse.json(detail);
}
