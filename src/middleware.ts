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
  // itself, and Next.js static assets. Everything else — including /api/sync, since the
  // in-process auto-sync scheduler calls runSync() directly rather than over HTTP and is
  // therefore unaffected by this middleware — requires a session. The daily Slack leaderboard
  // (services/slackNotifier.ts) is sent server-side by the in-process scheduler, not fetched by
  // Slack over HTTP, so it needs no exclusion here either.
  matcher: ["/((?!api/auth|auth/signin|_next/static|_next/image|favicon.ico).*)"],
};
