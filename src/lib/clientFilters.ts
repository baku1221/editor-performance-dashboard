// Client-side filter state shape + query-string builder. Mirrors the server's
// DashboardFilters (src/lib/filters.ts) field-for-field so every tab's fetch
// URL is built the same way.

export interface UiFilters {
  from: string; // '' = unset
  to: string; // '' = unset
  editor: string; // '' = all editors
}

export const emptyFilters: UiFilters = { from: "", to: "", editor: "" };

export function buildQueryString(filters: UiFilters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.editor) params.set("editor", filters.editor);
  return params.toString();
}
