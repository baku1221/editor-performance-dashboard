"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

interface DateRangePickerProps {
  from: string; // ISO yyyy-MM-dd, '' = unset
  to: string;
  onApply: (from: string, to: string) => void;
}

interface Preset {
  key: string;
  label: string;
  range: () => { from: string; to: string };
}

// Local-date-safe formatting — Date#toISOString() converts through UTC first, which silently
// shifts the date by a day in any positive-UTC-offset timezone (e.g. IST) when starting from a
// local midnight. Building the string from getFullYear/getMonth/getDate avoids that entirely.
function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoLocal(value: string): Date {
  const parts = value.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, m - 1, d);
}

function addDays(d: Date, delta: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + delta);
  return copy;
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function startOfWeekMonday(d: Date): Date {
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function buildPresets(today: Date): Preset[] {
  const yesterday = addDays(today, -1);
  const thisWeekStart = startOfWeekMonday(today);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const lastWeekEnd = addDays(thisWeekStart, -1);
  const thisMonthStart = startOfMonth(today);
  const lastMonthStart = addMonths(thisMonthStart, -1);
  const lastMonthEnd = addDays(thisMonthStart, -1);

  return [
    { key: "today", label: "Today", range: () => ({ from: iso(today), to: iso(today) }) },
    { key: "yesterday", label: "Yesterday", range: () => ({ from: iso(yesterday), to: iso(yesterday) }) },
    { key: "todayYesterday", label: "Today and yesterday", range: () => ({ from: iso(yesterday), to: iso(today) }) },
    { key: "last7", label: "Last 7 days", range: () => ({ from: iso(addDays(today, -7)), to: iso(yesterday) }) },
    { key: "last14", label: "Last 14 days", range: () => ({ from: iso(addDays(today, -14)), to: iso(yesterday) }) },
    { key: "last28", label: "Last 28 days", range: () => ({ from: iso(addDays(today, -28)), to: iso(yesterday) }) },
    { key: "last30", label: "Last 30 days", range: () => ({ from: iso(addDays(today, -30)), to: iso(yesterday) }) },
    { key: "thisWeek", label: "This week", range: () => ({ from: iso(thisWeekStart), to: iso(today) }) },
    { key: "lastWeek", label: "Last week", range: () => ({ from: iso(lastWeekStart), to: iso(lastWeekEnd) }) },
    { key: "thisMonth", label: "This month", range: () => ({ from: iso(thisMonthStart), to: iso(today) }) },
    { key: "lastMonth", label: "Last month", range: () => ({ from: iso(lastMonthStart), to: iso(lastMonthEnd) }) },
    { key: "maximum", label: "Maximum", range: () => ({ from: "", to: "" }) },
  ];
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const DAY_LABEL = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", year: "numeric" });
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function formatRangeLabel(from: string, to: string): string {
  if (!from && !to) return "Maximum";
  if (from && to && from === to) return DAY_LABEL.format(parseIsoLocal(from));
  if (from && to) return `${DAY_LABEL.format(parseIsoLocal(from))} – ${DAY_LABEL.format(parseIsoLocal(to))}`;
  if (from) return `From ${DAY_LABEL.format(parseIsoLocal(from))}`;
  return `Until ${DAY_LABEL.format(parseIsoLocal(to))}`;
}

function monthCells(monthAnchor: Date): Array<Date | null> {
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

function MonthGrid({
  monthAnchor,
  draftFrom,
  draftTo,
  onPick,
}: {
  monthAnchor: Date;
  draftFrom: string;
  draftTo: string;
  onPick: (isoDate: string) => void;
}) {
  const cells = monthCells(monthAnchor);

  return (
    <div className="w-64">
      <p className="mb-2 text-center text-sm font-medium text-app-text">{MONTH_LABEL.format(monthAnchor)}</p>
      <div className="grid grid-cols-7 text-center text-xs text-app-dim">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-sm">
        {cells.map((day, index) => {
          if (!day) return <span key={index} />;
          const dayIso = iso(day);
          const isEndpoint = dayIso === draftFrom || dayIso === draftTo;
          const inRange = Boolean(draftFrom && draftTo && dayIso > draftFrom && dayIso < draftTo);
          return (
            <button
              key={index}
              type="button"
              onClick={() => onPick(dayIso)}
              className={clsx(
                "mx-auto flex h-7 w-7 items-center justify-center rounded-full transition",
                isEndpoint
                  ? "bg-purple-600 text-white"
                  : inRange
                    ? "bg-purple-500/20 text-app-text"
                    : "text-app-text hover:bg-white/10"
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangePicker({ from, to, onApply }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [rightMonth, setRightMonth] = useState(() => startOfMonth(new Date()));
  const containerRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => new Date(), []);
  const presets = useMemo(() => buildPresets(today), [today]);
  const leftMonth = addMonths(rightMonth, -1);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setDraftFrom(from);
        setDraftTo(to);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, from, to]);

  function openPanel() {
    setDraftFrom(from);
    setDraftTo(to);
    setRightMonth(startOfMonth(to ? parseIsoLocal(to) : today));
    setOpen(true);
  }

  function pickPreset(preset: Preset) {
    const range = preset.range();
    setDraftFrom(range.from);
    setDraftTo(range.to);
    onApply(range.from, range.to);
    setOpen(false);
  }

  function pickDay(dayIso: string) {
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(dayIso);
      setDraftTo("");
    } else if (dayIso < draftFrom) {
      setDraftTo(draftFrom);
      setDraftFrom(dayIso);
    } else {
      setDraftTo(dayIso);
    }
  }

  function handleUpdate() {
    onApply(draftFrom, draftTo || draftFrom);
    setOpen(false);
  }

  function handleCancel() {
    setDraftFrom(from);
    setDraftTo(to);
    setOpen(false);
  }

  const activePresetKey = presets.find((p) => {
    const r = p.range();
    return r.from === draftFrom && r.to === draftTo;
  })?.key;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => (open ? handleCancel() : openPanel())}
        className="flex items-center gap-2 rounded-lg border border-app-border bg-app-bg px-3 py-1.5 text-sm text-app-text hover:border-purple-400 focus:border-purple-400 focus:outline-none"
      >
        <span aria-hidden>📅</span>
        {formatRangeLabel(from, to)}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 flex overflow-hidden rounded-xl border border-app-border bg-app-card shadow-2xl">
          <div className="flex w-48 flex-col border-r border-app-border py-2">
            {presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => pickPreset(preset)}
                className={clsx(
                  "px-3 py-2 text-left text-sm transition",
                  activePresetKey === preset.key
                    ? "bg-purple-600/20 text-purple-300"
                    : "text-app-muted hover:bg-white/5 hover:text-app-text"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col p-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setRightMonth((m) => addMonths(m, -1))}
                className="rounded-md px-2 py-1 text-app-muted hover:bg-white/10 hover:text-app-text"
              >
                ‹
              </button>
              <span className="text-xs text-app-dim">Select a custom range</span>
              <button
                type="button"
                onClick={() => setRightMonth((m) => addMonths(m, 1))}
                className="rounded-md px-2 py-1 text-app-muted hover:bg-white/10 hover:text-app-text"
              >
                ›
              </button>
            </div>

            <div className="mt-3 flex gap-6">
              <MonthGrid monthAnchor={leftMonth} draftFrom={draftFrom} draftTo={draftTo} onPick={pickDay} />
              <MonthGrid monthAnchor={rightMonth} draftFrom={draftFrom} draftTo={draftTo} onPick={pickDay} />
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-app-border pt-3">
              <span className="text-sm text-app-muted">{formatRangeLabel(draftFrom, draftTo)}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-lg px-3 py-1.5 text-sm text-app-muted hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleUpdate}
                  disabled={!draftFrom}
                  className="rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-40"
                >
                  Update
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
