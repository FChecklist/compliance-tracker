"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardTitle, CardHeader } from "@compliance/ui";
import { StatusBadge } from "@compliance/ui";
import Link from "next/link";

type Stats = { total: number; overdue: number; due_today: number; completed: number; in_progress: number; pending: number; draft: number };
type RecentItem = { id: string; title: string; status: string; priority: string; due_date: string | null; assignee_name: string | null; department_name: string | null; compliance_type: string };
type PendencyItem = { bucket: string; count: number };

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ total: 0, overdue: 0, due_today: 0, completed: 0, in_progress: 0, pending: 0, draft: 0 });
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [pendency, setPendency] = useState<PendencyItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/compliance/stats").then((r) => r.json()),
      fetch("/api/compliance?per_page=5&sort_by=created_at&sort_order=desc").then((r) => r.json()),
    ])
      .then(([statsData, listData]) => {
        if (statsData.stats) setStats(statsData.stats);
        if (listData.compliance) setRecent(listData.compliance);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Build pendency from stats
  const pendencyData = [
    { bucket: "Overdue", count: stats.overdue, color: "bg-red-500" },
    { bucket: "Due Today", count: stats.due_today, color: "bg-orange-500" },
    { bucket: "In Progress", count: stats.in_progress, color: "bg-blue-500" },
    { bucket: "Pending", count: stats.pending, color: "bg-yellow-500" },
    { bucket: "Draft", count: stats.draft, color: "bg-gray-400" },
    { bucket: "Completed", count: stats.completed, color: "bg-green-500" },
  ];

  const maxCount = Math.max(...pendencyData.map((d) => d.count), 1);

  const statCards = [
    { label: "Total Compliance", value: stats.total, icon: "📋", color: "border-l-blue-500", bg: "bg-blue-50" },
    { label: "Overdue", value: stats.overdue, icon: "🔴", color: "border-l-red-500", bg: "bg-red-50" },
    { label: "Due Today", value: stats.due_today, icon: "⏰", color: "border-l-orange-500", bg: "bg-orange-50" },
    { label: "In Progress", value: stats.in_progress, icon: "🔄", color: "border-l-blue-500", bg: "bg-blue-50" },
    { label: "Completed", value: stats.completed, icon: "✅", color: "border-l-green-500", bg: "bg-green-50" },
    { label: "Pending Review", value: stats.pending, icon: "⏳", color: "border-l-yellow-500", bg: "bg-yellow-50" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overview of your compliance management</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className={`bg-white rounded-xl border border-gray-200 border-l-4 ${card.color} p-5 hover:shadow-md transition-shadow`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">{card.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{card.value}</p>
              </div>
              <span className="text-3xl">{card.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pendency Breakdown — Horizontal Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-gray-800">Pendency Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendencyData.map((item) => (
              <div key={item.bucket} className="flex items-center gap-3">
                <span className="text-xs font-medium text-gray-600 w-24 text-right">{item.bucket}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${item.color} transition-all duration-500 flex items-center justify-end pr-2`}
                    style={{ width: `${(item.count / maxCount) * 100}%`, minWidth: item.count > 0 ? "2rem" : "0" }}
                  >
                    {item.count > 0 && <span className="text-[10px] font-bold text-white">{item.count}</span>}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Status Distribution — Simple Donut-like visual */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-gray-800">Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center mb-4">
              <div className="relative w-40 h-40">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  {(() => {
                    const items = [
                      { label: "Completed", count: stats.completed, color: "#16a34a" },
                      { label: "In Progress", count: stats.in_progress, color: "#2563eb" },
                      { label: "Pending", count: stats.pending, color: "#eab308" },
                      { label: "Overdue", count: stats.overdue, color: "#dc2626" },
                      { label: "Draft", count: stats.draft, color: "#9ca3af" },
                    ];
                    const total = items.reduce((s, i) => s + i.count, 0) || 1;
                    let offset = 0;
                    return items.map((item) => {
                      const pct = (item.count / total) * 100;
                      const el = (
                        <circle
                          key={item.label}
                          cx="18" cy="18" r="15.91549"
                          fill="none"
                          stroke={item.color}
                          strokeWidth="3"
                          strokeDasharray={`${pct} ${100 - pct}`}
                          strokeDashoffset={`${-offset}`}
                        />
                      );
                      offset += pct;
                      return el;
                    });
                  })()}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-gray-900">{stats.total}</span>
                  <span className="text-xs text-gray-500">Total</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: "Completed", count: stats.completed, color: "bg-green-500" },
                { label: "In Progress", count: stats.in_progress, color: "bg-blue-500" },
                { label: "Pending", count: stats.pending, color: "bg-yellow-500" },
                { label: "Overdue", count: stats.overdue, color: "bg-red-500" },
                { label: "Draft", count: stats.draft, color: "bg-gray-400" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                  <span className="text-gray-600">{item.label}</span>
                  <span className="font-medium text-gray-900 ml-auto">{item.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Compliance Items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold text-gray-800">Recent Compliance Items</CardTitle>
          <Link href="/compliance" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            View all →
          </Link>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No compliance items yet. Create your first one.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Title</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Status</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Priority</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Assignee</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Due Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((item) => (
                    <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2.5 px-3">
                        <Link href={`/compliance/${item.id}`} className="text-blue-600 hover:text-blue-800 font-medium hover:underline">
                          {item.title}
                        </Link>
                      </td>
                      <td className="py-2.5 px-3"><StatusBadge status={item.status} /></td>
                      <td className="py-2.5 px-3"><StatusBadge status={item.priority} /></td>
                      <td className="py-2.5 px-3 text-gray-600">{item.assignee_name ?? "—"}</td>
                      <td className="py-2.5 px-3 text-gray-500 text-xs">
                        {item.due_date ? new Date(item.due_date).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}