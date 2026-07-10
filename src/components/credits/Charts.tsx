"use client";

import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";
import type { OperatorSummary } from "@/lib/creditsDashboard";
import { sortOperators } from "@/lib/creditsDashboard";

ChartJS.register(BarElement, CategoryScale, LinearScale, ArcElement, Tooltip, Legend);

const PALETTE = ["#6366f1", "#22d3ee", "#4ade80", "#fb923c", "#a5b4fc", "#f472b6", "#facc15", "#38bdf8"];

function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length] as string;
}

const AXIS_COLOR = "#94a3b8";
const GRID_COLOR = "#2d3148";

export function OperatorCreditsBarChart({ operators }: { operators: OperatorSummary[] }) {
  const sorted = sortOperators(operators, "totalCredits", "desc");

  return (
    <Bar
      data={{
        labels: sorted.map((o) => o.operator),
        datasets: [
          {
            label: "Total Credits",
            data: sorted.map((o) => o.totalCredits),
            backgroundColor: sorted.map((_, i) => colorFor(i)),
            borderRadius: 6,
          },
        ],
      }}
      options={{
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: AXIS_COLOR }, grid: { color: GRID_COLOR } },
          y: { ticks: { color: AXIS_COLOR }, grid: { color: GRID_COLOR } },
        },
      }}
    />
  );
}

export function OperatorShareDoughnutChart({ operators }: { operators: OperatorSummary[] }) {
  const sorted = sortOperators(operators, "totalCredits", "desc");

  return (
    <Doughnut
      data={{
        labels: sorted.map((o) => o.operator),
        datasets: [
          {
            data: sorted.map((o) => o.totalCredits),
            backgroundColor: sorted.map((_, i) => colorFor(i)),
            borderColor: "#1a1d2e",
            borderWidth: 2,
          },
        ],
      }}
      options={{
        responsive: true,
        plugins: {
          legend: { position: "bottom", labels: { color: AXIS_COLOR, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const values = ctx.dataset.data as number[];
                const total = values.reduce((s, v) => s + v, 0);
                const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : "0";
                return `${ctx.label}: ${pct}%`;
              },
            },
          },
        },
      }}
    />
  );
}

export function CreditsPerClipEfficiencyChart({ operators }: { operators: OperatorSummary[] }) {
  const sorted = sortOperators(operators, "creditsPerClip", "asc");

  return (
    <Bar
      data={{
        labels: sorted.map((o) => o.operator),
        datasets: [
          {
            label: "Credits / Clip",
            data: sorted.map((o) => o.creditsPerClip),
            backgroundColor: sorted.map((_, i) => colorFor(i)),
            borderRadius: 6,
          },
        ],
      }}
      options={{
        indexAxis: "y",
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: AXIS_COLOR }, grid: { color: GRID_COLOR } },
          y: { ticks: { color: AXIS_COLOR }, grid: { color: GRID_COLOR } },
        },
      }}
    />
  );
}
