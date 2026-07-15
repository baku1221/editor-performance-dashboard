import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getDailyLeaderboards, type LeaderboardEntry } from "@/lib/services/leaderboardService";

export const runtime = "nodejs";

const RANK_MEDALS = ["🥇", "🥈", "🥉"];

function rankLabel(index: number): string {
  return RANK_MEDALS[index] ?? `${index + 1}.`;
}

function LeaderboardColumn({ title, entries }: { title: string; entries: LeaderboardEntry[] }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        backgroundColor: "#0a0a0d",
        border: "1px solid #1f2129",
        borderRadius: 16,
        padding: 28,
      }}
    >
      <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#f1f5f9", marginBottom: 20 }}>{title}</div>
      {entries.length === 0 ? (
        <div style={{ display: "flex", fontSize: 20, color: "#64748b" }}>No ads yet</div>
      ) : (
        entries.map((entry, i) => (
          <div
            key={entry.editorName}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 0",
              borderTop: i === 0 ? "none" : "1px solid #1f2129",
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", width: 44, fontSize: 24 }}>{rankLabel(i)}</div>
              <div style={{ display: "flex", fontSize: 22, color: "#f1f5f9" }}>{entry.editorName}</div>
            </div>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 700, color: "#c4b5fd" }}>{entry.mainAdsCount}</div>
          </div>
        ))
      )}
    </div>
  );
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!config.slack.leaderboardImageSecret || token !== config.slack.leaderboardImageSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { date, today, month } = await getDailyLeaderboards(5);

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: "#000000",
          padding: 40,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", marginBottom: 24 }}>
          <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: "#e9d5ff" }}>🏆 Editor Leaderboard</div>
          <div style={{ display: "flex", fontSize: 18, color: "#94a3b8", marginTop: 4 }}>{date}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "row", gap: 24, flex: 1 }}>
          <LeaderboardColumn title="Today — Main Ads" entries={today} />
          <LeaderboardColumn title="This Month — Main Ads" entries={month} />
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
