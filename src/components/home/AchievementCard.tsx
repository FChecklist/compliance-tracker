"use client";

import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

type StatsData = {
  total: number;
  completed: number;
};

export default function AchievementCard() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/compliance/stats")
      .then((r) => r.json())
      .then((d) => {
        setData({ total: d.total ?? 0, completed: d.completed ?? 0 });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

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