import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canViewAvniRow } from "@/lib/auth";
import { parseDashboardFilters } from "@/lib/filters";
import { getScriptWriterDetail, parseScriptWriterGroup } from "@/lib/services/scriptWriterService";

export async function GET(request: NextRequest, { params }: { params: { name: string } }) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const scriptWriter = decodeURIComponent(params.name);
  const group = parseScriptWriterGroup(request.nextUrl.searchParams.get("group"));

  if (group === "India" && scriptWriter.toLowerCase() === "avni") {
    const session = await getServerSession(authOptions);
    if (!canViewAvniRow(session?.user?.email)) {
      return NextResponse.json({ error: "Not authorized to view this script writer." }, { status: 403 });
    }
  }

  const detail = await getScriptWriterDetail(scriptWriter, filters, group);
  return NextResponse.json(detail);
}
