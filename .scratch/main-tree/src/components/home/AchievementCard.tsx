"use client";

import { Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useComplianceStats } from "@/lib/queries/use-compliance-stats";

export default function AchievementCard() {
  // Shared react-query cache instead of its own /api/compliance/stats
  // fetch-on-mount.
  const { data, isLoading: loading } = useComplianceStats();

  if (loading) {
    return (
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-5">
          <div className="h-4 w-48 bg-gray-200 rounded animate-pulse mb-3" />
          <div className="h-2 w-full bg-gray-200 rounded animate-pulse mb-2" />
          <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.total === 0) {
    return (
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-5">
          <p className="text-sm text-ct-muted">No compliance items yet.</p>
        </CardContent>
      </Card>
    );
  }

  const completed = data.completed;
  const total = data.total;
  const rate = Math.round((completed / total) * 100);

  return (
    <Card className="rounded-xl shadow-card bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
          <Trophy className="size-4 text-ct-saffron" />
          Achievement
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-0">
        <p className="text-sm font-medium text-ct-navy mb-2">
          {completed} of {total} compliance items completed this month
        </p>
        <Progress value={rate} className="h-2 mb-2" />
        <p className="text-xs text-ct-muted">
          {rate}% complete
          {rate > 80 && (
            <span className="text-emerald-600 font-medium">
              {" "}— Great work! Almost there.
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}