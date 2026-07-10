import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        status: {
          working: "#2563eb",
          review: "#d97706",
          completed: "#16a34a",
          delayed: "#dc2626",
        },
        // Same palette as "credits" (kept separate on purpose — the two names are used in
        // different files and renaming credits.* everywhere risked breaking working code for
        // no benefit). This is the whole app's dark theme now, not just AI Credits.
        app: {
          bg: "#0f1117",
          card: "#1a1d2e",
          border: "#2d3148",
          text: "#e2e8f0",
          muted: "#94a3b8",
          dim: "#64748b",
        },
        // Scoped to the AI Credits dashboard only.
        credits: {
          bg: "#0f1117",
          card: "#1a1d2e",
          border: "#2d3148",
          accent: "#6366f1",
          purple: "#a5b4fc",
          green: "#4ade80",
          orange: "#fb923c",
          cyan: "#22d3ee",
          text: "#e2e8f0",
          muted: "#94a3b8",
          dim: "#64748b",
        },
      },
      screens: {
        creditsmd: "900px",
      },
    },
  },
  plugins: [],
};

export default config;
