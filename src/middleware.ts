import { withAuth } from "next-auth/middleware";

// Gates the entire dashboard behind a Google sign-in restricted to the org domain (see
// src/lib/auth.ts's signIn callback) — every page and API route requires a valid session except
// the exclusions in `matcher` below. `withAuth` handles the redirect-to-sign-in itself; nothing
// else needed here.
export default withAuth({
  pages: {
    signIn: "/auth/signin",
  },
});

export const config = {
  // Excludes: NextAuth's own routes (would otherwise be a redirect loop), the sign-in page
  // itself, Next.js static assets, and the Slack leaderboard image — Slack's servers fetch that
  // one directly to render the daily message and can't complete a Google OAuth flow, so it's
  // protected by a shared-secret token in the URL instead (see leaderboard-image/route.tsx).
  // Everything else — including /api/sync, since the in-process auto-sync scheduler calls
  // runSync() directly rather than over HTTP and is therefore unaffected by this middleware —
  // requires a session.
  matcher: ["/((?!api/auth|auth/signin|api/slack/leaderboard-image|_next/static|_next/image|favicon.ico).*)"],
};
