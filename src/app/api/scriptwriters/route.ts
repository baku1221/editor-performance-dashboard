import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canViewIndiaCopywriters } from "@/lib/auth";
import { parseDashboardFilters } from "@/lib/filters";
import { getScriptWriterData, type ScriptWriterGroup } from "@/lib/services/scriptWriterService";

export async function GET(request: NextRequest) {
  const filters = parseDashboardFilters(request.nextUrl.searchParams);
  const group: ScriptWriterGroup = request.nextUrl.searchParams.get("group") === "India" ? "India" : "Foreign";

  if (group === "India") {
    const session = await getServerSession(authOptions);
    if (!canViewIndiaCopywriters(session?.user?.email)) {
      return NextResponse.json({ error: "Not authorized to view India Copy Writer data." }, { status: 403 });
    }
  }

  const data = await getScriptWriterData(filters, group);
  return NextResponse.json(data);
}
