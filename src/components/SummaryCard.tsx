import clsx from "clsx";

export function SummaryCard({
  label,
  value,
  sub,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        "rounded-xl border border-app-border bg-app-card p-4 shadow-sm",
        onClick && "cursor-pointer transition hover:border-purple-400/50 hover:bg-white/5"
      )}
    >
      <div className="text-sm text-app-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-app-text">{value}</div>
      {sub && <div className="mt-1 text-xs text-app-dim">{sub}</div>}
    </div>
  );
}
