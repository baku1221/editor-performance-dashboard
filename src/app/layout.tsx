import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Editor Performance Dashboard",
  description: "Editor productivity, creative performance, progress, and AI credit usage.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
