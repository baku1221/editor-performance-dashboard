import { config } from "../config";
import { getDailyLeaderboards, type LeaderboardEntry } from "./leaderboardService";

function formatList(entries: LeaderboardEntry[]): string {
  if (entries.length === 0) return "_No ads yet_";
  return entries.map((e, i) => `${i + 1}. *${e.editorName}* — ${e.mainAdsCount} ads`).join("\n");
}

/**
 * Posts the daily leaderboard to Slack via an Incoming Webhook — a plain webhook (not a bot
 * token) is enough here because the image is embedded by URL rather than uploaded as a file:
 * Slack's servers fetch config.slack.publicBaseUrl + the image route themselves when rendering
 * the message, the same way any link-unfurl works. That route is deliberately excluded from the
 * Google sign-in gate (see middleware.ts) since Slack can't complete an OAuth flow — it's
 * protected by leaderboardImageSecret in the URL instead.
 */
export async function sendDailyLeaderboardToSlack(): Promise<void> {
  if (!config.slack.webhookUrl) {
    throw new Error("SLACK_WEBHOOK_URL is not set — nothing to send to.");
  }
  if (!config.slack.publicBaseUrl) {
    throw new Error("NEXTAUTH_URL is not set — Slack needs a public URL to fetch the leaderboard image from.");
  }

  const { date, today, month } = await getDailyLeaderboards(5);
  const imageUrl = `${config.slack.publicBaseUrl}/api/slack/leaderboard-image?token=${encodeURIComponent(config.slack.leaderboardImageSecret)}`;

  const res = await fetch(config.slack.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blocks: [
        { type: "header", text: { type: "plain_text", text: `🏆 Editor Leaderboard — ${date}` } },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Today's Top Editors*\n${formatList(today)}` },
            { type: "mrkdwn", text: `*This Month's Top Editors*\n${formatList(month)}` },
          ],
        },
        { type: "image", image_url: imageUrl, alt_text: "Editor Leaderboard" },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook returned ${res.status}: ${await res.text()}`);
  }
}
