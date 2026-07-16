import { config } from "../config";
import { getDailyLeaderboards, type LeaderboardEntry } from "./leaderboardService";

function formatList(entries: LeaderboardEntry[]): string {
  if (entries.length === 0) return "_No ads yet_";
  return entries.map((e, i) => `${i + 1}. *${e.editorName}* — ${e.mainAdsCount} ads`).join("\n");
}

/**
 * Posts the daily leaderboard to Slack via an Incoming Webhook — plain text, no image. "Today"
 * lists every editor who made a Main ad today (not a top-N cutoff — a full daily roll call), and
 * "This Month" stays a top-5 ranking.
 */
export async function sendDailyLeaderboardToSlack(): Promise<void> {
  if (!config.slack.webhookUrl) {
    throw new Error("SLACK_WEBHOOK_URL is not set — nothing to send to.");
  }

  const { date, today, month } = await getDailyLeaderboards(5);

  const res = await fetch(config.slack.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blocks: [
        { type: "header", text: { type: "plain_text", text: "🏆 Editor Leaderboard" } },
        { type: "section", text: { type: "mrkdwn", text: `*Today's Videos — ${date}*\n${formatList(today)}` } },
        { type: "divider" },
        { type: "section", text: { type: "mrkdwn", text: `*Top 5 This Month (till ${date})*\n${formatList(month)}` } },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook returned ${res.status}: ${await res.text()}`);
  }
}
