"use client";

import { useState } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/swrFetcher";
import { emptyFilters, type UiFilters } from "@/lib/clientFilters";
import { DateRangePicker } from "./DateRangePicker";
import { AddEditorButton } from "./AddEditorButton";

const fieldClass =
  "rounded-lg border border-app-border bg-app-bg px-2.5 py-1.5 text-sm text-app-text focus:border-purple-400 focus:outline-none";

export function FiltersBar({
  filters,
  onChange,
}: {
  filters: UiFilters;
  onChange: (next: UiFilters) => void;
}) {
  const { data: editors, mutate: mutateEditors } = useSWR<string[]>("/api/editors", jsonFetcher);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  function setDateRange(from: string, to: string) {
    onChange({ ...filters, from, to });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-app-border bg-app-card p-3 shadow-sm">
      <DateRangePicker from={filters.from} to={filters.to} onApply={setDateRange} />

      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-app-muted">Editor</label>
        <select
          className={fieldClass}
          value={filters.editor}
          onChange={(e) => onChange({ ...filters, editor: e.target.value })}
        >
          <option value="">All editors</option>
          {editors?.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <AddEditorButton
        onAdded={(name) => {
          mutateEditors();
          setJustAdded(name);
          window.setTimeout(() => setJustAdded(null), 4000);
        }}
      />
      {justAdded && (
        <span className="text-xs text-green-400">
          Added "{justAdded}" — click "Sync now" to pick up their ads.
        </span>
      )}

      <button
        onClick={() => onChange(emptyFilters)}
        className="ml-auto rounded-lg px-2.5 py-1.5 text-sm text-app-muted hover:bg-app-border"
      >
        Clear filters
      </button>
    </div>
  );
}
