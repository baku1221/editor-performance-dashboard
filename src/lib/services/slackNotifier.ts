import { config } from "../config";
import { getDailyLeaderboards, type LeaderboardEntry } from "./leaderboardService";
import { getMonthlyReport, type MonthlyReportEntry } from "./monthlyReportService";
import { formatFriendlyDate, formatMonthLabel } from "../timezone";

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

function formatRanked(entries: MonthlyReportEntry[], suffix: (value: number) => string): string {
  if (entries.length === 0) return "_No data_";
  return entries.map((e, i) => `${i + 1}. *${e.editorName}* — ${suffix(e.value)}`).join("\n");
}

// Winning % alone hides how small the sample behind it is — e.g. 1-for-1 reads identically to
// 20-for-20 — so this shows the Main Ads count it was computed from alongside it.
function formatWinningPercent(entries: MonthlyReportEntry[]): string {
  if (entries.length === 0) return "_No data_";
  return entries.map((e, i) => `${i + 1}. *${e.editorName}* — ${e.value}% (${e.mainAdsCount ?? 0} Main Ads)`).join("\n");
}

// Same units/order as formatBusinessUnitTotals, but Astrotalk Foreign/Lumus's number here is
// Main Ads specifically (see monthlyReportService.ts's MAIN_ADS_ONLY_UNITS) — the label must say
// so, or it reads as the same Main+Cut total the daily message shows.
const MAIN_ADS_ONLY_UNITS = new Set(["Astrotalk", "Lumus"]);

function formatMonthlyBusinessUnitTotals(totals: Record<string, number>): string {
  return BUSINESS_UNIT_TOTALS_ORDER.map(({ businessUnit, label }) => {
    const metric = MAIN_ADS_ONLY_UNITS.has(businessUnit) ? "Main Ads" : "total videos";
    return `*${label}*: ${totals[businessUnit] ?? 0} ${metric}`;
  }).join("\n");
}

function formatDuration(seconds: number): string {
  return `${seconds.toLocaleString()}s`;
}

/**
 * The end-of-month follow-up to the daily leaderboard (see sendDailyLeaderboardToSlack, which
 * still sends as normal on this same day) — a separate, more detailed message: the month's total
 * output per business unit (Main Ads specifically for Astrotalk Foreign/Lumus, not Main+Cut — see
 * monthlyReportService.ts's MAIN_ADS_ONLY_UNITS), then four top-5 rankings (MVE Score, Winning %,
 * Main Ads, Duration), then the bottom 5 by MVE Score with an encouraging nudge rather than just a
 * bare list. Abhi (a static-image designer, not a video editor) is excluded from every ranking.
 */
export async function sendMonthlyReportToSlack(monthStart: string, monthEnd: string): Promise<void> {
  if (!config.slack.webhookUrl) {
    throw new Error("SLACK_WEBHOOK_URL is not set — nothing to send to.");
  }

  const report = await getMonthlyReport(monthStart, monthEnd);
  const monthLabel = formatMonthLabel(monthStart);

  const res = await fetch(config.slack.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blocks: [
        { type: "header", text: { type: "plain_text", text: `📊 Monthly Report — ${monthLabel}` } },
        { type: "section", text: { type: "mrkdwn", text: formatMonthlyBusinessUnitTotals(report.businessUnitTotals) } },
        { type: "divider" },
        { type: "section", text: { type: "mrkdwn", text: `*🏅 Top 5 — MVE Score*\n${formatRanked(report.topByMve, (v) => `${v}`)}` } },
        { type: "section", text: { type: "mrkdwn", text: `*🎯 Top 5 — Winning %*\n${formatWinningPercent(report.topByWinningPercent)}` } },
        { type: "section", text: { type: "mrkdwn", text: `*🎬 Top 5 — Main Ads*\n${formatRanked(report.topByMainAds, (v) => `${v} ads`)}` } },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*⏱️ Top 5 — Duration*\n${formatRanked(report.topByDuration, formatDuration)}` },
        },
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Needs a push*\n${formatRanked(report.bottomByMve, (v) => `${v}`)}\n\n_Buckle up — see you in the top 5 next month!_ 💪`,
          },
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook returned ${res.status}: ${await res.text()}`);
  }
}
