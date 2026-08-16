"use client";

import { useQuery } from "@tanstack/react-query";

export type ComplianceStats = {
  total: number;
  overdue: number;
  dueThisWeek: number;
  completed: number;
  dueIn30Days: number;
  safe: number;
  noticeCount: number;
};

async function fetchComplianceStats(): Promise<ComplianceStats> {
  const r = await fetch("/api/compliance/stats");
  if (!r.ok) throw new Error("Failed to fetch /api/compliance/stats");
  const d = await r.json();
  return {
    total: d.total ?? 0,
    overdue: d.overdue ?? 0,
    dueThisWeek: d.dueThisWeek ?? 0,
    completed: d.completed ?? 0,
    dueIn30Days: d.dueIn30Days ?? 0,
    safe: d.safe ?? d.completed ?? 0,
    noticeCount: d.noticeCount ?? 0,
  };
}

// Shared across AppShell, HealthRibbon, AchievementCard, and the home page --
// same dedup rationale as useMe().
export function useComplianceStats() {
  return useQuery({ queryKey: ["compliance-stats"], queryFn: fetchComplianceStats });
}
