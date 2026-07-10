import { NextResponse } from "next/server";
import { publishedVideoRepository } from "@/lib/repositories/publishedVideoRepository";
import { progressRepository } from "@/lib/repositories/progressRepository";

/** Distinct editor names across Meta videos + Progress Tracker, for the filter dropdown. */
export async function GET() {
  const [videos, progress] = await Promise.all([publishedVideoRepository.getAll(), progressRepository.getAll()]);

  const names = new Set<string>();
  videos.forEach((v) => v.editorName && names.add(v.editorName));
  progress.forEach((p) => names.add(p.editorName));

  return NextResponse.json(Array.from(names).sort((a, b) => a.localeCompare(b)));
}
