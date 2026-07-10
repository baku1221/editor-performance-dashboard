import type { CreditsKpis } from "@/lib/creditsDashboard";

export function KpiCards({ kpis }: { kpis: CreditsKpis }) {
  const cards = [
    { label: "Total Credits Used", value: kpis.totalCredits.toLocaleString() },
    { label: "Total Clips Generated", value: kpis.totalClips.toLocaleString() },
    { label: "Avg Credits / Clip", value: kpis.avgCreditsPerClip.toLocaleString() },
    { label: "Top Consumer", value: kpis.topConsumer ?? "—" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 creditsmd:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-credits-border bg-credits-card p-4">
          <div className="text-xs text-credits-muted">{card.label}</div>
          <div className="mt-1 text-2xl font-semibold text-credits-text">{card.value}</div>
        </div>
      ))}
    </div>
  );
}
