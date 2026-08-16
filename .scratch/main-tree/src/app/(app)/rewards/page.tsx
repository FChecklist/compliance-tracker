"use client";

export const dynamic = "force-dynamic";

// Wave 113: VERI TREASURE -- the standalone hub for the 'veri_reward'
// product branch (points, achievements, streaks, refer-and-earn). Free and
// on-by-default for every org (see 0098_veri_reward_branch.sql), but given
// its own full page rather than folded entirely into /home, since it's
// also meant to be sellable/marketable as its own module.
import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Gem, Flame, Trophy, Share2, Copy, Check, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type Achievement = {
  achievementKey: string;
  context: string;
  displayName: string;
  description: string | null;
  targetValue: number;
  pointsReward: number;
  progressValue: number;
  unlockedAt: string | null;
};

type Streak = { streakKey: string; currentCount: number; longestCount: number; graceAvailable: boolean };

type Summary = {
  enabled: boolean;
  pointsBalance?: number;
  pointsHistory?: { delta: number; sourceType: string; reason: string | null; createdAt: string }[];
  achievements?: Achievement[];
  streaks?: Streak[];
};

type LeaderboardRow = { userId: string; name: string; avatarUrl: string | null; balance: number };

type ReferralRow = { referralToken: string; targetType: string; status: string; clickCount: number; rewardPoints: number | null; createdAt: string };

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

const STATUS_LABEL: Record<string, string> = {
  clicked: "Link shared",
  signup_completed: "Signed up",
  org_provisioned: "Joined VERIDIAN",
  paid: "Converted",
  lost: "Not converted",
};

export default function RewardsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[] | null>(null);
  const [referrals, setReferrals] = useState<ReferralRow[] | null>(null);
  const [myLink, setMyLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const [summaryRes, leaderboardRes, referralRes] = await Promise.all([
      fetch("/api/veri-reward").then((r) => r.json()).catch(() => null),
      fetch("/api/veri-reward/leaderboard").then((r) => r.json()).catch(() => null),
      fetch("/api/veri-reward/referral").then((r) => r.json()).catch(() => null),
    ]);
    setSummary(summaryRes);
    setLeaderboard(leaderboardRes?.leaderboard ?? []);
    setReferrals(referralRes?.referrals ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Visiting the hub is itself a natural "daily login" signal for the
    // streak system -- fire-and-forget, never blocks the page render.
    fetch("/api/veri-reward/streak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streakKey: "daily_login" }),
    }).catch(() => {});
    load();
  }, [load]);

  const generateLink = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/veri-reward/referral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "customer_to_customer" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to generate link");
      setMyLink(`${window.location.origin}/vr/${data.referralToken}`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate referral link");
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = () => {
    if (!myLink) return;
    navigator.clipboard.writeText(myLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-56 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!summary?.enabled) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2">
            <Gem className="size-6 text-ct-saffron" /> VERI TREASURE
          </h1>
        </div>
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-6 text-sm text-ct-muted">
            VERI TREASURE is not enabled for this organisation.
          </CardContent>
        </Card>
      </div>
    );
  }

  const streaksByKey = new Map((summary.streaks ?? []).map((s) => [s.streakKey, s]));
  const loginStreak = streaksByKey.get("daily_login");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2">
          <Gem className="size-6 text-ct-saffron" /> VERI TREASURE
        </h1>
        <p className="text-sm text-ct-muted mt-1">Every win, worth something — points, achievements, streaks, and refer-and-earn.</p>
      </div>

      {/* Points + streak summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-5">
            <p className="text-xs font-medium text-ct-muted uppercase tracking-wide">Points balance</p>
            <p className="mt-1 font-heading text-3xl text-ct-navy">{summary.pointsBalance ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-5">
            <p className="text-xs font-medium text-ct-muted uppercase tracking-wide flex items-center gap-1">
              <Flame className="size-3.5 text-amber-500" /> Daily streak
            </p>
            <p className="mt-1 font-heading text-3xl text-ct-navy">{loginStreak?.currentCount ?? 0}</p>
            <p className="text-xs text-ct-muted mt-0.5">Longest: {loginStreak?.longestCount ?? 0} days</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-5">
            <p className="text-xs font-medium text-ct-muted uppercase tracking-wide">Achievements unlocked</p>
            <p className="mt-1 font-heading text-3xl text-ct-navy">
              {(summary.achievements ?? []).filter((a) => a.unlockedAt).length}
              <span className="text-base text-ct-muted"> / {(summary.achievements ?? []).length}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Achievements */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
            <Trophy className="size-4 text-ct-saffron" /> Achievements
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {(summary.achievements ?? []).length === 0 ? (
            <p className="text-sm text-ct-muted">No achievements configured yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(summary.achievements ?? []).map((a) => {
                const rate = Math.min(100, Math.round((a.progressValue / a.targetValue) * 100));
                return (
                  <div key={a.achievementKey} className="rounded-lg border border-ct-border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-ct-navy">{a.displayName}</p>
                      {a.unlockedAt ? (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Unlocked</Badge>
                      ) : (
                        <span className="text-xs text-ct-muted whitespace-nowrap">+{a.pointsReward} pts</span>
                      )}
                    </div>
                    {a.description && <p className="text-xs text-ct-muted mt-1">{a.description}</p>}
                    <Progress value={rate} className="h-1.5 mt-3" />
                    <p className="text-xs text-ct-muted mt-1">{a.progressValue} / {a.targetValue}</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Refer and earn */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
              <Share2 className="size-4 text-ct-saffron" /> Invite &amp; earn
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <p className="text-sm text-ct-muted">Share your link — when someone signs up through it, you earn points.</p>
            {myLink ? (
              <div className="flex items-center gap-2">
                <input readOnly value={myLink} className="flex-1 rounded-md border border-ct-border bg-ct-cloud/40 px-3 py-2 text-xs text-ct-slate" />
                <Button size="sm" variant="outline" onClick={copyLink}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={generateLink} disabled={generating} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {generating ? "Generating…" : "Get my referral link"}
              </Button>
            )}
            {(referrals ?? []).length > 0 && (
              <div className="pt-2 space-y-2">
                {(referrals ?? []).map((r) => (
                  <div key={r.referralToken} className="flex items-center justify-between text-xs">
                    <span className="text-ct-slate">{STATUS_LABEL[r.status] ?? r.status} · {r.clickCount} click{r.clickCount !== 1 ? "s" : ""}</span>
                    {r.rewardPoints ? <span className="text-emerald-600 font-medium">+{r.rewardPoints} pts</span> : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Leaderboard */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
              <Users className="size-4 text-ct-saffron" /> Team leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {(leaderboard ?? []).length === 0 ? (
              <p className="text-sm text-ct-muted">No points earned yet — be the first!</p>
            ) : (
              <div className="space-y-2">
                {(leaderboard ?? []).map((row, i) => (
                  <div key={row.userId} className="flex items-center gap-3">
                    <span className="w-4 text-xs font-semibold text-ct-muted">{i + 1}</span>
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-ct-navy text-white text-[10px] font-bold">{getInitials(row.name)}</AvatarFallback>
                    </Avatar>
                    <span className="flex-1 text-sm text-ct-navy truncate">{row.name}</span>
                    <span className="text-sm font-medium text-ct-saffron">{row.balance}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-ct-navy">Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {(summary.pointsHistory ?? []).length === 0 ? (
            <p className="text-sm text-ct-muted">No activity yet.</p>
          ) : (
            <div className="space-y-2">
              {(summary.pointsHistory ?? []).map((h, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-ct-slate">{h.reason ?? h.sourceType}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={h.delta >= 0 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>
                      {h.delta >= 0 ? "+" : ""}{h.delta}
                    </span>
                    <span className="text-xs text-ct-muted">{formatDistanceToNow(new Date(h.createdAt), { addSuffix: true })}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
