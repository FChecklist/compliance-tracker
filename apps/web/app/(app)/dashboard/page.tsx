"use client";
import { useEffect, useState } from "react";

type Stats = { total: number; overdue: number; due_today: number; completed: number };

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ total: 0, overdue: 0, due_today: 0, completed: 0 });

  useEffect(() => {
    fetch("/api/compliance/stats").then(r => r.json()).then(d => setStats(d.stats ?? stats)).catch(() => {});
  }, []);

  const cards = [
    { label: "Total Compliance", value: stats.total, color: "bg-blue-50 text-blue-700" },
    { label: "Overdue", value: stats.overdue, color: "bg-red-50 text-red-700" },
    { label: "Due Today", value: stats.due_today, color: "bg-yellow-50 text-yellow-700" },
    { label: "Completed", value: stats.completed, color: "bg-green-50 text-green-700" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(c => (
          <div key={c.label} className={`rounded-xl p-5 ${c.color}`}>
            <p className="text-sm font-medium opacity-70">{c.label}</p>
            <p className="text-3xl font-bold mt-1">{c.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Recent Activity</h2>
        <p className="text-sm text-gray-400">No recent activity yet.</p>
      </div>
    </div>
  );
}