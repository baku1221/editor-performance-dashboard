import { config } from "../config";
import { getDailyLeaderboards, type LeaderboardEntry } from "./leaderboardService";
import { formatFriendlyDate } from "../timezone";

function formatList(entries: LeaderboardEntry[]): string {
  if (entries.length === 0) return "_No ads yet_";
  return entries.map((e, i) => `${i + 1}. *${e.editorName}* — ${e.mainAdsCount} ads`).join("\n");
}

// businessUnit (config.ts's DEFAULT_ACCOUNT_LABELS/config values) -> the label the team actually
// uses when talking about these accounts day to day. "Astrotalk" is internally the "PPP Videsh
// Yatra AT Foreign" campaign, always called "Astrotalk Foreign" in conversation; "Astrotalk
// Store" is just "Store" for short.
const BUSINESS_UNIT_TOTALS_ORDER: Array<{ businessUnit: string; label: string }> = [
  { businessUnit: "Astrotalk", label: "Astrotalk Foreign" },
  { businessUnit: "Lumus", label: "Lumus" },
  { businessUnit: "Astrotalk Store", label: "Store" },
];

function formatBusinessUnitTotals(totals: Record<string, number>): string {
  return BUSINESS_UNIT_TOTALS_ORDER.map(({ businessUnit, label }) => `*${label}*: ${totals[businessUnit] ?? 0} total videos`).join("\n");
}

/**
 * Posts the daily leaderboard to Slack via an Incoming Webhook — plain text, no image. "Today"
 * lists every editor who made a Main ad today (not a top-N cutoff — a full daily roll call),
 * followed by each business unit's total video count (Main + Cut) for the day, and "This Month"
 * stays a top-5 ranking.
 */
export async function sendDailyLeaderboardToSlack(): Promise<void> {
  if (!config.slack.webhookUrl) {
    throw new Error("SLACK_WEBHOOK_URL is not set — nothing to send to.");
  }

  const { date, today, month, businessUnitTotals } = await getDailyLeaderboards(5);
  const friendlyDate = formatFriendlyDate(date);

  const res = await fetch(config.slack.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blocks: [
        { type: "header", text: { type: "plain_text", text: "🏆 Editor Leaderboard" } },
        { type: "section", text: { type: "mrkdwn", text: `*Today: ${friendlyDate}*\n${formatList(today)}` } },
        { type: "divider" },
        { type: "section", text: { type: "mrkdwn", text: formatBusinessUnitTotals(businessUnitTotals) } },
        { type: "divider" },
        { type: "section", text: { type: "mrkdwn", text: `*Top 5 This Month (till ${date})*\n${formatList(month)}` } },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook returned ${res.status}: ${await res.text()}`);
  }
}
