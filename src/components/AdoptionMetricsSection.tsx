"use client";

import { useState, useEffect, useCallback } from "react";
import { TrendingUp, Users, Bot, Video, CheckSquare, FileBarChart, MessageSquare, Building2, Trophy, TrendingDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface DepartmentAdoption {
  departmentId: string;
  departmentName: string;
  activeUserCount: number;
  tasksCompletedCount: number;
}

interface AdoptionMetrics {
  totalUsers: number;
  activeUsers: number;
  adoptionPercent: number;
  aiAdoptionPercent: number;
  meetingsManaged: number;
  tasksCompleted: number;
  reportsGenerated: number;
  aiConversations: number;
  departmentsActive: number;
  totalDepartments: number;
  hoursSaved: null;
  hoursSavedNote: string;
  departmentBreakdown: DepartmentAdoption[];
  topPerformingDepartment: DepartmentAdoption | null;
  lowestAdoptionDepartment: DepartmentAdoption | null;
}

// subagent/audit-lifecycle (tree4-unified/50-completion-plan Priority 2
// item 3, D27/U-D27.B2.S1 "Adoption Dashboard"): the Org Master Admin/CEO
// view the tree names -- no adoption-dashboard existed anywhere before
// this (confirmed by direct search). Read-only (no PATCH -- these are
// computed metrics, not settings), mirroring OrgLimitsSection.tsx's
// loading/layout conventions for settings-page consistency.
export default function AdoptionMetricsSection() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<AdoptionMetrics | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/adoption-metrics");
      if (!res.ok) return;
      const data = await res.json();
      setMetrics(data.metrics);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!metrics) {
    return <p className="text-sm text-muted-foreground">Adoption metrics are unavailable right now.</p>;
  }

  const stats = [
    { label: "Adoption", value: `${metrics.adoptionPercent}%`, sub: `${metrics.activeUsers} of ${metrics.totalUsers} users onboarded`, icon: TrendingUp },
    { label: "AI Adoption", value: `${metrics.aiAdoptionPercent}%`, sub: "active users who've used AI at least once", icon: Bot },
    { label: "Meetings Managed", value: metrics.meetingsManaged, sub: "VERI Meetings recorded", icon: Video },
    { label: "Tasks Completed", value: metrics.tasksCompleted, sub: "org-wide, all time", icon: CheckSquare },
    { label: "Reports Generated", value: metrics.reportsGenerated, sub: "saved report definitions", icon: FileBarChart },
    { label: "AI Conversations", value: metrics.aiConversations, sub: "AI-thread chats started", icon: MessageSquare },
    { label: "Departments Active", value: `${metrics.departmentsActive} / ${metrics.totalDepartments}`, sub: "with at least 1 active user", icon: Building2 },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <stat.icon className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{stat.label}</span>
            </div>
            <div className="text-xl font-semibold text-ct-navy">{stat.value}</div>
            <p className="text-[11px] text-muted-foreground leading-tight">{stat.sub}</p>
          </div>
        ))}
        <div className="rounded-lg border border-dashed p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Hours Saved</span>
          </div>
          <div className="text-xl font-semibold text-muted-foreground">N/A</div>
          <p className="text-[11px] text-muted-foreground leading-tight">{metrics.hoursSavedNote}</p>
        </div>
      </div>

      {(metrics.topPerformingDepartment || metrics.lowestAdoptionDepartment) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {metrics.topPerformingDepartment && (
            <div className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5 text-ct-saffron" />
                <span className="text-xs font-medium">Top-Performing Team</span>
              </div>
              <div className="text-sm font-semibold text-ct-navy">{metrics.topPerformingDepartment.departmentName}</div>
              <p className="text-[11px] text-muted-foreground">
                {metrics.topPerformingDepartment.tasksCompletedCount} tasks completed, {metrics.topPerformingDepartment.activeUserCount} active user{metrics.topPerformingDepartment.activeUserCount === 1 ? "" : "s"}
              </p>
            </div>
          )}
          {metrics.lowestAdoptionDepartment && (
            <div className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center gap-1.5">
                <TrendingDown className="h-3.5 w-3.5 text-ct-muted" />
                <span className="text-xs font-medium">Lowest Adoption Team</span>
                {metrics.lowestAdoptionDepartment.departmentId === metrics.topPerformingDepartment?.departmentId && (
                  <Badge variant="outline" className="text-[10px]">only active dept.</Badge>
                )}
              </div>
              <div className="text-sm font-semibold text-ct-navy">{metrics.lowestAdoptionDepartment.departmentName}</div>
              <p className="text-[11px] text-muted-foreground">
                {metrics.lowestAdoptionDepartment.tasksCompletedCount} tasks completed, {metrics.lowestAdoptionDepartment.activeUserCount} active user{metrics.lowestAdoptionDepartment.activeUserCount === 1 ? "" : "s"}
              </p>
            </div>
          )}
        </div>
      )}

      {metrics.departmentBreakdown.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">All departments</h4>
          <div className="rounded-lg border divide-y">
            {metrics.departmentBreakdown.map((dept) => (
              <div key={dept.departmentId} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-ct-navy">{dept.departmentName}</span>
                <span className="text-muted-foreground text-xs">
                  {dept.activeUserCount} active &middot; {dept.tasksCompletedCount} tasks completed
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
