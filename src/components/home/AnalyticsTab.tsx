"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardAnalytics } from "./DashboardAnalytics";

type Rollup = {
  scope: "individual" | "team" | "org";
  peopleCount: number | null;
  complianceByStatus: Record<string, number>;
  taskByStatus: Record<string, number>;
};

const SCOPE_LABEL: Record<Rollup["scope"], string> = {
  individual: "Your pace",
  team: "Your team's pace",
  org: "Organisation-wide",
};

function sum(obj: Record<string, number>) {
  return Object.values(obj).reduce((a, b) => a + b, 0);
}

export function AnalyticsTab() {
  const [rollup, setRollup] = useState<Rollup | null>(null);

  useEffect(() => {
    fetch("/api/home/analytics").then((r) => r.json()).then(setRollup).catch(() => {});
  }, []);

  // Org-wide tier reuses the existing, richer analytics dashboard verbatim
  // (real GRC stats, charts, tables) rather than rebuilding it as a
  // simplified rollup -- that content was already correct for this tier.
  if (rollup?.scope === "org") return <DashboardAnalytics />;

  if (!rollup) return <p className="text-sm text-ct-muted">Loading...</p>;

  const complianceTotal = sum(rollup.complianceByStatus);
  const taskTotal = sum(rollup.taskByStatus);
  const taskCompleted = rollup.taskByStatus.completed ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-lg text-ct-navy">{SCOPE_LABEL[rollup.scope]}</h2>
        {rollup.scope === "team" && rollup.peopleCount !== null && (
          <p className="text-sm text-ct-muted">Across you and {rollup.peopleCount - 1} direct report{rollup.peopleCount - 1 === 1 ? "" : "s"}</p>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-ct-muted font-medium">Compliance items</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-ct-navy">{complianceTotal}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-ct-muted font-medium">Overdue</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-red-600">{rollup.complianceByStatus.overdue ?? 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-ct-muted font-medium">Tasks</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-ct-navy">{taskTotal}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-ct-muted font-medium">Task completion</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-ct-teal">{taskTotal > 0 ? Math.round((taskCompleted / taskTotal) * 100) : 0}%</p></CardContent>
        </Card>
      </div>
    </div>
  );
}
