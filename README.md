# Editor Performance Dashboard

Internal dashboard for editor productivity, creative performance, project progress, and AI credit usage. No database — data is read live from Google Sheets (Progress Tracker) and the Meta Ads API (published videos + performance), plus an uploaded Lumina CSV, and held in server memory.

**A published Meta ad IS the video.** There's no separate "Completed Videos" sheet — a video only counts once it's actually live on Meta, and the editor is attributed by parsing their name out of the ad title (not by cross-referencing a sheet).

## Setup

```bash
npm install
cp .env.local.example .env.local   # fill in the values below
npm run dev
```

Open http://localhost:3000.

### 1. Google Sheets (Progress Tracker only)

1. In Google Cloud Console, enable the **Google Sheets API** for a project.
2. Create a **Service Account**, then generate a JSON key for it.
3. From the JSON key file, copy `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `private_key` → `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` in `.env.local` (keep the `\n` escapes on one line).
4. Open the sheet and click **Share** → add the service account's email as **Viewer**.
5. Copy the sheet's id from its URL (`.../spreadsheets/d/<ID>/edit`) into `PROGRESS_TRACKER_SHEET_ID`.
6. By default the app reads the `Ad Tracker-foreign(AT)` and `Ad Tracker-foreign(LUMUS)` tabs (the `Ad Tracker-India` tab is intentionally excluded). Override via `PROGRESS_TRACKER_TABS` if tab names change.

Columns are located by **header name**, not fixed position, since real tabs don't share one exact layout — currently matched: `Posted Date`, `Ad Name`, `Status`, `Editor`, and `Completed Date`/`Date` (whichever is present). There's no deadline column in the real data, so:
- "Delayed" is only shown if the sheet's Status text itself says so — it's never auto-derived from an overdue date.
- Rows with a blank Editor cell (unassigned backlog ideas) show under an **"Unassigned"** bucket rather than being dropped.
- The `Completed Date` column in the UI shows whatever the sheet has, not a target/deadline.

### 2. Meta Ads API (video count + creative performance)

1. Set `META_ACCESS_TOKEN` to a Marketing API access token with `ads_read` (system user token recommended for a long-lived internal tool).
2. Set `META_AD_ACCOUNT_IDS` to a comma-separated list of `act_...` ids — only ads in these accounts show up on the Performance tab.
3. `META_CONVERSION_ACTION_TYPES` controls which Meta `action_type`s count as "conversions" for CPA/CPI (defaults to app-install types).

Each ad is fetched from the `/ads` edge (`id`, `name`, `created_time`, `effective_status`, campaign) — `created_time` is the video's "submission/published date". Lifetime performance metrics (spend, impressions, CTR, CPM, CPC, conversions) come from a separate `/insights` call joined by ad id.

**Editor attribution** is parsed directly from the ad title, per this confirmed naming convention:

```
party on boat | V1 - Main | Parul - SYAT - Samridhi-PPP
                              ^^^^^ editor name
```

The editor is the first `" - "`-delimited token of the **last** `"|"`-delimited segment (see `src/lib/services/editorTitleParser.ts`). Titles that don't fit this convention are left unattributed — they still count toward "Total Videos Submitted" and show as an **"Unmapped"** row in the Performance table rather than being silently dropped, but won't appear under any editor's name. Set `EDITOR_ROSTER` in `.env.local` once you have a canonical editor list, to normalize casing/whitespace differences in the parsed name (e.g. "parul" / "Parul " / "PARUL" all collapse to one name).

### 3. Winning Creative rule

Configurable without touching code, via `.env.local`:

```
WINNING_RULE_METRIC=cpi      # spend | cpi | cpa | ctr | cpc | cpm
WINNING_RULE_OPERATOR=lt     # lt | lte | gt | gte
WINNING_RULE_VALUE=350
```

Default: a video is "winning" if its cost-per-install is under ₹350. A manual override always takes precedence over the rule (see `publishedVideoRepository.setManualOverride` — not yet wired to a UI control, but the plumbing exists for a future "mark as winning" button).

### 4. Lumina CSV (AI credits)

Use the **Upload Lumina CSV** button on the AI Credits tab. Column headers are matched loosely (case/spacing-insensitive) against: Editor, Credits Used, Date, Project. Each upload replaces the current credits data — upload the full latest export each time, not a delta.

## Architecture

```
src/lib/datasources/   → talks to the outside world (Sheets API, Meta Graph API, CSV parsing). Nothing else touches these directly.
src/lib/repositories/  → one interface + in-memory implementation per entity (published videos, progress, credits).
src/lib/services/      → business logic: editor-title parsing, winning-creative rule, per-tab aggregation, sync orchestration.
src/app/api/           → thin HTTP layer over the services.
src/components/        → UI, fetches from src/app/api via SWR.
```

**Adding a real database later** means writing a new repository (e.g. `PostgresPublishedVideoRepository implements PublishedVideoRepository`) and swapping the export in `src/lib/repositories/*.ts` — services, API routes, and the UI don't change, since they only ever depend on the repository interfaces, not on how data is stored.

Sync behavior:
- On dashboard load, and whenever **Sync now** is clicked, the Progress Tracker sheet and the Meta Ads API are re-fetched in parallel; a failure in one source doesn't block the other (hover the status dot next to "Sync now" for per-source status).
- The winning-creative rule (and any manual overrides) are recomputed after every sync.
- Lumina credits only change via CSV upload — there's no live Lumina API here.
