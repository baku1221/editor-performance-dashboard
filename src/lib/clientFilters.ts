// Client-side filter state shape + query-string builder. Mirrors the server's
// DashboardFilters (src/lib/filters.ts) field-for-field so every tab's fetch
// URL is built the same way.

export interface UiFilters {
  from: string; // '' = unset
  to: string; // '' = unset
  editor: string; // '' = all editors
}

export const emptyFilters: UiFilters = { from: "", to: "", editor: "" };

function toLocalIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Initial filter state on page load — "This month" through today, not "Clear filters"'s Maximum. */
export function defaultFilters(): UiFilters {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toLocalIso(monthStart), to: toLocalIso(now), editor: "" };
}

export function buildQueryString(filters: UiFilters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.editor) params.set("editor", filters.editor);
  return params.toString();
}
