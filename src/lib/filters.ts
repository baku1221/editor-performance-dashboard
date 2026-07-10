import type { DashboardFilters } from "./types";

// Applied identically across all three tabs so filter behavior never drifts
// between Performance / Daily Progress / AI Credits.

export function parseDashboardFilters(searchParams: URLSearchParams): DashboardFilters {
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;
  const editorName = searchParams.get("editor") ?? undefined;

  return {
    dateRange: from || to ? { from, to } : undefined,
    editorName: editorName || undefined,
  };
}

export function dateWithinFilters(isoDate: string | null | undefined, filters: DashboardFilters): boolean {
  if (!isoDate) return false;

  if (filters.dateRange?.from && isoDate < filters.dateRange.from) return false;
  if (filters.dateRange?.to && isoDate > filters.dateRange.to) return false;

  return true;
}

export function editorMatchesFilter(editorName: string, filters: DashboardFilters): boolean {
  if (!filters.editorName) return true;
  return editorName.toLowerCase() === filters.editorName.toLowerCase();
}
