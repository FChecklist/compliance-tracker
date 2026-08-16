"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gem, Flame, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type Summary = {
  enabled: boolean;
  pointsBalance?: number;
  streaks?: { streakKey: string; currentCount: number }[];
};

// Wave 113 (VERI Treasure). Compact dashboard teaser -- points balance + the
// best-running streak, linking through to the full /rewards hub. Mirrors
// AchievementCard.tsx's own fetch-on-mount/skeleton shape so the two sit
// naturally side by side on the home dashboard.
export default function VeriTreasureWidget() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/veri-reward")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-5">
          <div className="h-4 w-40 bg-gray-200 rounded animate-pulse mb-3" />
          <div className="h-6 w-24 bg-gray-200 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.enabled) return null;

  const topStreak = (data.streaks ?? []).reduce(
    (best, s) => (s.currentCount > (best?.currentCount ?? 0) ? s : best),
    undefined as { streakKey: string; currentCount: number } | undefined
  );

  return (
    <Link href="/rewards" className="block group">
      <Card className="rounded-xl shadow-card bg-white transition-shadow hover:shadow-md">
        <CardContent className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-ct-navy text-white">
              <Gem className="size-5 text-ct-saffron" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ct-navy">VERI TREASURE</p>
              <p className="text-xs text-ct-muted">
                {data.pointsBalance ?? 0} points
                {topStreak && topStreak.currentCount > 0 && (
                  <span className="inline-flex items-center gap-1 ml-2 text-amber-600">
                    <Flame className="size-3" /> {topStreak.currentCount} day streak
                  </span>
                )}
              </p>
            </div>
          </div>
          <ArrowRight className="size-4 text-ct-muted opacity-0 group-hover:opacity-100 transition-opacity" />
        </CardContent>
      </Card>
    </Link>
  );
}
