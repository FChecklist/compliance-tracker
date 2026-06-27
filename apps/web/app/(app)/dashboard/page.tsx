"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────

type StatsData = {
  total: number;
  overdue: number;
  due_today: number;
  completed: number;
  pending: number;
  in_progress: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
};

type OverdueItem = {
  id: string;
  title: string;
  compliance_type: string;
  priority: string;
  due_date: string | null;
};

// ─── Constants ────────────────────────────────────────────────────────────

const CHART_COLORS = [
  "#3b82f6", // blue-500
  "#22c55e", // green-500
  "#eab308", // yellow-500
  "#ef4444", // red-500
  "#a855f7", // purple-500
  "#06b6d4", // cyan-500
  "#f97316", // orange-500
  "#ec4899", // pink-500
];

function formatType(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatStatusLabel(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Stat Cards Config ────────────────────────────────────────────────────

const STAT_CARDS = [
  {
    key: "total",
    label: "Total",
    bg: "bg-blue-50",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    textColor: "text-blue-700",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path fillRule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.243 0l-7 7a3 3 0 0 0 4.243 4.243l7-7a3 3 0 0 0 0-4.243Zm-6.414 7L3.414 9.586a1 1 0 0 1 0-1.414l2-2a1 1 0 0 1 1.414 0L12 11.586l4.172-4.172a1 1 0 1 1 1.414 1.414L13.414 13l-2 2Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    key: "pending",
    label: "Pending",
    bg: "bg-yellow-50",
    iconBg: "bg-yellow-100",
    iconColor: "text-yellow-600",
    textColor: "text-yellow-700",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    key: "in_progress",
    label: "In Progress",
    bg: "bg-blue-50",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    textColor: "text-blue-700",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path d="M15.983 1.908a.75.75 0 0 0-1.292-.657l-8.5 9.5A.75.75 0 0 0 6.75 12h6.572l-1.305 6.093a.75.75 0 0 0 1.292.657l8.5-9.5A.75.75 0 0 0 21.25 8h-6.572l1.305-6.093Z" />
      </svg>
    ),
  },
  {
    key: "completed",
    label: "Completed",
    bg: "bg-green-50",
    iconBg: "bg-green-100",
    iconColor: "text-green-600",
    textColor: "text-green-700",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    key: "overdue",
    label: "Overdue",
    bg: "bg-red-50",
    iconBg: "bg-red-100",
    iconColor: "text-red-600",
    textColor: "text-red-700",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    key: "due_today",
    label: "Due Today",
    bg: "bg-amber-50",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    textColor: "text-amber-700",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path fillRule="evenodd" d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z" clipRule="evenodd" />
      </svg>
    ),
  },
] as const;

// ─── Skeleton Components ─────────────────────────────────────────────────

function StatCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl bg-white border border-gray-200 p-5">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-gray-200" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-16 rounded bg-gray-200" />
          <div className="h-7 w-12 rounded bg-gray-200" />
        </div>
      </div>
    </div>
  );
}

function StatCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="animate-pulse rounded-xl bg-white border border-gray-200 p-6">
      <div className="h-5 w-40 rounded bg-gray-200 mb-6" />
      <div className="h-64 rounded-lg bg-gray-100" />
    </div>
  );
}

function OverdueListSkeleton() {
  return (
    <div className="animate-pulse rounded-xl bg-white border border-gray-200 p-6">
      <div className="h-5 w-48 rounded bg-gray-200 mb-5" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-lg border border-gray-100 p-3">
            <div className="h-9 w-9 rounded-lg bg-gray-200" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-3/5 rounded bg-gray-200" />
              <div className="h-3 w-24 rounded bg-gray-200" />
            </div>
            <div className="h-3 w-20 rounded bg-gray-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Error Component ─────────────────────────────────────────────────────

function SectionError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0">
        <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
      </svg>
      <span className="flex-1">{message}</span>
      <button
        onClick={onRetry}
        className="shrink-0 rounded-md bg-white px-3 py-1 text-xs font-semibold text-red-700 shadow-sm border border-red-200 transition-colors hover:bg-red-100"
      >
        Retry
      </button>
    </div>
  );
}

// ─── Custom Tooltip ──────────────────────────────────────────────────────

function CustomBarTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="text-sm font-bold text-gray-900">{payload[0].value}</p>
    </div>
  );
}

function CustomPieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { fill: string } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.payload.fill }} />
        <span className="text-xs font-medium text-gray-500">{d.name}</span>
      </div>
      <p className="mt-0.5 text-sm font-bold text-gray-900">{d.value}</p>
    </div>
  );
}

// ─── Dashboard Page ──────────────────────────────────────────────────────

export default function DashboardPage() {
  // ── Stats state ────────────────────────────────────────────────────────
  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  // ── Overdue items state ────────────────────────────────────────────────
  const [overdueItems, setOverdueItems] = useState<OverdueItem[]>([]);
  const [overdueLoading, setOverdueLoading] = useState(true);
  const [overdueError, setOverdueError] = useState<string | null>(null);

  // ── Fetch stats ────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const res = await fetch("/api/compliance/stats");
      if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Unexpected response");
      setStats(json.data);
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // ── Fetch overdue items ────────────────────────────────────────────────
  const fetchOverdue = useCallback(async () => {
    setOverdueLoading(true);
    setOverdueError(null);
    try {
      const res = await fetch("/api/compliance?status=overdue&limit=5");
      if (!res.ok) throw new Error(`Failed to load overdue items (${res.status})`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Unexpected response");
      setOverdueItems(json.data ?? []);
    } catch (err) {
      setOverdueError(err instanceof Error ? err.message : "Failed to load overdue items");
    } finally {
      setOverdueLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchOverdue();
  }, [fetchStats, fetchOverdue]);

  // ── Prepare chart data ─────────────────────────────────────────────────
  const barData = stats
    ? Object.entries(stats.by_type).map(([type, count]) => ({
        name: formatType(type),
        value: count,
      }))
    : [];

  const pieData = stats
    ? Object.entries(stats.by_status).map(([status, count]) => ({
        name: formatStatusLabel(status),
        value: count,
      }))
    : [];

  const priorityColor: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-yellow-500",
    low: "bg-green-500",
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Overview of your compliance tracking
        </p>
      </div>

      {/* ── TOP ROW: Stat Cards ─────────────────────────────────────────── */}
      {statsLoading ? (
        <StatCardsSkeleton />
      ) : statsError ? (
        <SectionError message={statsError} onRetry={fetchStats} />
      ) : stats ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {STAT_CARDS.map((card) => {
            const value = stats[card.key as keyof StatsData] as number;
            return (
              <div
                key={card.key}
                className={`rounded-xl ${card.bg} border border-gray-200/60 p-5 transition-shadow hover:shadow-sm`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${card.iconBg} ${card.iconColor}`}
                  >
                    {card.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-500 truncate">
                      {card.label}
                    </p>
                    <p className={`text-2xl font-bold ${card.textColor}`}>
                      {value.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ── MIDDLE ROW: Charts ──────────────────────────────────────────── */}
      {statsLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      ) : statsError ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionError message={statsError} onRetry={fetchStats} />
          <SectionError message={statsError} onRetry={fetchStats} />
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Bar Chart – Compliance by Type */}
          <div className="rounded-xl bg-white border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-1">
              Compliance by Type
            </h2>
            <p className="text-xs text-gray-400 mb-5">
              Breakdown across compliance categories
            </p>
            {barData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={barData}
                  margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
                >
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={{ stroke: "#e5e7eb" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomBarTooltip />} cursor={{ fill: "#f3f4f6" }} />
                  <Bar
                    dataKey="value"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={48}
                  >
                    {barData.map((_, index) => (
                      <Cell
                        key={`bar-cell-${index}`}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[280px] items-center justify-center text-sm text-gray-400">
                No type data available
              </div>
            )}
          </div>

          {/* Pie Chart – Status Distribution */}
          <div className="rounded-xl bg-white border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-1">
              Status Distribution
            </h2>
            <p className="text-xs text-gray-400 mb-5">
              Current status of all compliance items
            </p>
            {pieData.length > 0 ? (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={3}
                      dataKey="value"
                      nameKey="name"
                      stroke="none"
                    >
                      {pieData.map((_, index) => (
                        <Cell
                          key={`pie-cell-${index}`}
                          fill={CHART_COLORS[index % CHART_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomPieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Legend */}
                <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
                  {pieData.map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor:
                            CHART_COLORS[index % CHART_COLORS.length],
                        }}
                      />
                      <span className="text-xs text-gray-600">{entry.name}</span>
                      <span className="text-xs font-semibold text-gray-800">
                        {entry.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-[280px] items-center justify-center text-sm text-gray-400">
                No status data available
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ── BOTTOM: Recent Overdue Items ─────────────────────────────────── */}
      {overdueLoading ? (
        <OverdueListSkeleton />
      ) : overdueError ? (
        <SectionError message={overdueError} onRetry={fetchOverdue} />
      ) : (
        <div className="rounded-xl bg-white border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-gray-800">
                Recent Overdue Items
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Compliance items that have passed their due date
              </p>
            </div>
            <Link
              href="/compliance?status=overdue"
              className="text-xs font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline"
            >
              View all &rarr;
            </Link>
          </div>

          {overdueItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="mb-3 h-10 w-10 text-gray-300"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-sm font-medium text-gray-500">
                No overdue items — you&apos;re all caught up!
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {overdueItems.map((item) => (
                <Link
                  key={item.id}
                  href={`/compliance/${item.id}`}
                  className="flex items-center gap-4 rounded-lg p-3 -mx-3 transition-colors hover:bg-gray-50"
                >
                  {/* Priority indicator */}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-4 w-4 text-red-500"
                    >
                      <path
                        fillRule="evenodd"
                        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>

                  {/* Title & type */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {item.title}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="inline-block rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                        {formatType(item.compliance_type)}
                      </span>
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${priorityColor[item.priority] ?? "bg-gray-400"}`}
                      />
                      <span className="text-[10px] font-medium text-gray-400 capitalize">
                        {item.priority}
                      </span>
                    </div>
                  </div>

                  {/* Due date */}
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium text-red-600">
                      {formatDate(item.due_date)}
                    </p>
                    <p className="text-[10px] text-gray-400">Due date</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}