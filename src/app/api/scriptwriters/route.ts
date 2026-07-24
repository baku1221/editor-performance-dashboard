import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canViewAvniRow } from "@/lib/auth";
import { parseDashboardFilters } from "@/lib/filters";
import { getScriptWriterData, type ScriptWriterGroup } from "@/lib/services/scriptWriterService";

export async function GET(request: NextRequest) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const group: ScriptWriterGroup = request.nextUrl.searchParams.get("group") === "India" ? "India" : "Foreign";
  const data = await getScriptWriterData(filters, group);

  if (group === "India") {
    const session = await getServerSession(authOptions);
    if (!canViewAvniRow(session?.user?.email)) {
      return NextResponse.json(data.filter((row) => row.scriptWriter.toLowerCase() !== "avni"));
    }
  }

  return NextResponse.json(data);
}
