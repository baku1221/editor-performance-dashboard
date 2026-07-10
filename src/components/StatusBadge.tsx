import clsx from "clsx";
import type { ProgressStatus } from "@/lib/types";

// Simplified to two colors on purpose — everything still in motion (Working/Review/Delayed/Not
// Started) reads as one "in progress" yellow, and only a truly finished item is green.
const STYLES: Record<ProgressStatus, string> = {
  "Not Started": "bg-yellow-500/15 text-yellow-300",
  Working: "bg-yellow-500/15 text-yellow-300",
  Review: "bg-yellow-500/15 text-yellow-300",
  Completed: "bg-green-500/15 text-green-300",
  Delayed: "bg-yellow-500/15 text-yellow-300",
};

export function StatusBadge({ status }: { status: ProgressStatus }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", STYLES[status])}>
      {status}
    </span>
  );
}
