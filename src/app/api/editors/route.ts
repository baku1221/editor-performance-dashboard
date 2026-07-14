import { NextResponse } from "next/server";
import { publishedVideoRepository } from "@/lib/repositories/publishedVideoRepository";
import { progressRepository } from "@/lib/repositories/progressRepository";
import { editorRosterRepository } from "@/lib/repositories/editorRosterRepository";

/** Distinct editor names across Meta videos + Progress Tracker, for the filter dropdown. */
export async function GET() {
  const [videos, progress] = await Promise.all([publishedVideoRepository.getAll(), progressRepository.getAll()]);

  const names = new Set<string>();
  videos.forEach((v) => v.editorName && names.add(v.editorName));
  progress.forEach((p) => names.add(p.editorName));

  return NextResponse.json(Array.from(names).sort((a, b) => a.localeCompare(b)));
}

/**
 * Adds a new editor to the roster (on top of the env-configured EDITOR_ROSTER) so a team member
 * who isn't in that list yet can be recognized — takes effect on the next sync (see
 * syncService.ts's runSync, which re-fetches the merged roster every time). Body:
 * { name: string, aliases?: string[] }.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const aliases = Array.isArray(body?.aliases) ? body.aliases.filter((a: unknown): a is string => typeof a === "string" && a.trim().length > 0).map((a: string) => a.trim()) : [];

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const existing = await editorRosterRepository.getEffective();
  const nameLower = name.toLowerCase();
  const alreadyExists = existing.some((entry) => entry.aliases.some((alias) => alias.toLowerCase() === nameLower));
  if (alreadyExists) {
    return NextResponse.json({ error: `"${name}" is already in the roster` }, { status: 409 });
  }

  await editorRosterRepository.add({ canonical: name, aliases: [name, ...aliases] });
  return NextResponse.json({ ok: true });
}
