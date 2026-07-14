import type { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

function csv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
}

// Restricts sign-in to a single Google Workspace domain — nobody outside the org can log in at
// all, regardless of whether they have a Google account. Checked two ways: the `hd` (hosted
// domain) claim Google includes on Workspace accounts, and a plain email-suffix check as a
// fallback for any provider response shape that omits `hd`.
const ALLOWED_DOMAIN = (process.env.ALLOWED_GOOGLE_DOMAIN ?? "").toLowerCase();

// Separate, narrower allowlist for admin-only actions (e.g. adding a new editor) — being an org
// member is enough to view the dashboard, but not enough to mutate the editor roster.
export const ADMIN_EMAILS = csv(process.env.ADMIN_EMAILS);

export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async signIn({ profile }) {
      if (!ALLOWED_DOMAIN) return true; // not configured — auth still works, just not domain-restricted
      const hd = (profile as { hd?: string } | undefined)?.hd?.toLowerCase();
      const email = profile?.email?.toLowerCase() ?? "";
      return hd === ALLOWED_DOMAIN || email.endsWith(`@${ALLOWED_DOMAIN}`);
    },
  },
};

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
