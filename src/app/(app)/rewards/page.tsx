"use client";

export const dynamic = "force-dynamic";

// Wave 113: VERI TREASURE -- the standalone hub for the 'veri_reward'
// product branch (points, achievements, streaks, refer-and-earn). Free and
// on-by-default for every org (see 0098_veri_reward_branch.sql), but given
// its own full page rather than folded entirely into /home, since it's
// also meant to be sellable/marketable as its own module.
import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { Gem, Flame, Trophy, Share2, Copy, Check, Users, Download, Info, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

// localStorage key for the set of achievementKeys this browser has already
// toasted an unlock for -- so revisiting /rewards after an unlock that
// happened elsewhere (e.g. a document upload) shows a one-time celebratory
// toast instead of repeating on every load. The real, always-fires trigger
// is the server-side notifications row written the instant the unlock
// happens (see checkAndUnlockAchievements in veri-reward-service.ts) --
// this is a page-level complement, not the primary fix.
const SEEN_UNLOCKS_KEY = "veri-reward-seen-unlocks";

function readSeenUnlocks(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_UNLOCKS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSeenUnlocks(keys: Set<string>) {
  try {
    localStorage.setItem(SEEN_UNLOCKS_KEY, JSON.stringify(Array.from(keys)));
  } catch {
    /* best-effort only */
  }
}

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

type HistoryItem = { delta: number; sourceType: string; reason: string | null; createdAt: string };

type EngagementReport = {
  totalPointsAwarded: number;
  totalPointsRedeemed: number;
  netPointsBalance: number;
  achievementDefinitionsCount: number;
  achievementUnlocksCount: number;
  achievementUnlockRate: number;
  activeUserCount: number;
  referralsCreatedCount: number;
  referralsConvertedCount: number;
  referralConversionRate: number;
};

const HISTORY_PAGE_SIZE = 20;

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export default function RewardsPage() {
  // task-20260718-083002 (Review Framework "Localization Readiness" gap):
  // this page's own static chrome (titles, labels, "how it works" copy) is
  // now wired into the platform's real next-intl system (see
  // messages/en.json's/messages/hi.json's own "Rewards" namespace),
  // matching the convention AppSidebar.tsx/login-form.tsx already use.
  // Honest, disclosed limitation: achievement/streak DISPLAY COPY
  // (achievement_definitions.displayName/description, seeded platform-
  // default rows) is stored in the DB as plain English text with no
  // per-locale column -- genuinely localizing that would need a schema
  // change (e.g. per-locale columns or an i18n-key indirection keyed by
  // achievementKey), out of scope for this pass. Left as a real, named
  // follow-up in PROGRESS.md rather than silently claimed done.
  const t = useTranslations("Rewards");
  const STATUS_LABEL: Record<string, string> = {
    clicked: t("statusClicked"),
    signup_completed: t("statusSignupCompleted"),
    org_provisioned: t("statusOrgProvisioned"),
    paid: t("statusPaid"),
    lost: t("statusLost"),
  };
  const [summary, setSummary] = useState<Summary | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[] | null>(null);
  const [leaderboardHasMore, setLeaderboardHasMore] = useState(false);
  const [loadingMoreLeaderboard, setLoadingMoreLeaderboard] = useState(false);
  const [referrals, setReferrals] = useState<ReferralRow[] | null>(null);
  const [myLink, setMyLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [report, setReport] = useState<EngagementReport | null>(null);

  // Points-history list: fetched from the dedicated paginated/filterable
  // endpoint (not summary.pointsHistory's fixed most-recent-20), so
  // "Load more" and the date-range filter both work against the same
  // real total.
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [exporting, setExporting] = useState(false);

  const fetchHistory = useCallback(async (offset: number, filters: { startDate: string; endDate: string }) => {
    const params = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE), offset: String(offset) });
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
    const res = await fetch(`/api/veri-reward/history?${params.toString()}`).then((r) => r.json()).catch(() => null);
    return { history: (res?.history ?? []) as HistoryItem[], total: (res?.total ?? 0) as number };
  }, []);

  const load = useCallback(async () => {
    const [summaryRes, leaderboardRes, referralRes, historyRes, reportRes] = await Promise.all([
      fetch("/api/veri-reward").then((r) => r.json()).catch(() => null),
      fetch(`/api/veri-reward/leaderboard?limit=10`).then((r) => (r.ok ? r.json() : { leaderboard: [] })).catch(() => null),
      fetch("/api/veri-reward/referral").then((r) => r.json()).catch(() => null),
      fetchHistory(0, { startDate: "", endDate: "" }),
      // Admin/manager-only -- a 403 for a regular member is expected, not an
      // error; the report section simply doesn't render for them.
      fetch("/api/veri-reward/admin-report").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    setSummary(summaryRes);
    const leaderboardRows: LeaderboardRow[] = leaderboardRes?.leaderboard ?? [];
    setLeaderboard(leaderboardRows);
    setLeaderboardHasMore(leaderboardRows.length >= 10);
    setReferrals(referralRes?.referrals ?? []);
    setHistory(historyRes.history);
    setHistoryTotal(historyRes.total);
    setReport(reportRes?.report ?? null);
    setLoading(false);

    // Toast any achievement the summary shows as unlocked that this browser
    // hasn't already been shown -- see readSeenUnlocks()'s own comment for
    // why this is a page-level complement to the real server-side
    // notifications row, not the primary fix.
    const seen = readSeenUnlocks();
    const newlyUnlocked = (summaryRes?.achievements ?? []).filter(
      (a: Achievement) => a.unlockedAt && !seen.has(a.achievementKey)
    );
    if (newlyUnlocked.length > 0) {
      for (const a of newlyUnlocked as Achievement[]) {
        toast.success(`Achievement unlocked: ${a.displayName}`, { description: `+${a.pointsReward} points` });
        seen.add(a.achievementKey);
      }
      writeSeenUnlocks(seen);
    }
  }, [fetchHistory]);

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

  const loadMoreHistory = async () => {
    if (!history) return;
    setLoadingMoreHistory(true);
    try {
      const { history: nextPage, total } = await fetchHistory(history.length, { startDate, endDate });
      setHistory([...history, ...nextPage]);
      setHistoryTotal(total);
    } finally {
      setLoadingMoreHistory(false);
    }
  };

  const applyDateFilter = async () => {
    setLoadingMoreHistory(true);
    try {
      const { history: filtered, total } = await fetchHistory(0, { startDate, endDate });
      setHistory(filtered);
      setHistoryTotal(total);
    } finally {
      setLoadingMoreHistory(false);
    }
  };

  const loadMoreLeaderboard = async () => {
    if (!leaderboard) return;
    setLoadingMoreLeaderboard(true);
    try {
      const params = new URLSearchParams({ limit: "10", offset: String(leaderboard.length) });
      const res = await fetch(`/api/veri-reward/leaderboard?${params.toString()}`).then((r) => r.json()).catch(() => null);
      const nextPage: LeaderboardRow[] = res?.leaderboard ?? [];
      setLeaderboard([...leaderboard, ...nextPage]);
      setLeaderboardHasMore(nextPage.length >= 10);
    } finally {
      setLoadingMoreLeaderboard(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const res = await fetch(`/api/veri-reward/export?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to export points history");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `veri-reward-points-history-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export points history");
    } finally {
      setExporting(false);
    }
  };

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
            <Gem className="size-6 text-ct-saffron-text" /> {t("pageTitle")}
          </h1>
        </div>
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-6 text-sm text-ct-muted">
            {t("notEnabled")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const streaksByKey = new Map((summary.streaks ?? []).map((s) => [s.streakKey, s]));
  const loginStreak = streaksByKey.get("daily_login");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2">
            <Gem className="size-6 text-ct-saffron-text" /> {t("pageTitle")}
          </h1>
          <p className="text-sm text-ct-muted mt-1">{t("tagline")}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowHowItWorks((v) => !v)} className="shrink-0">
          <Info className="size-3.5 mr-1.5" /> {t("howItWorks")}
        </Button>
      </div>

      {showHowItWorks && (
        <Card className="rounded-xl shadow-card bg-ct-cloud/40 border-ct-saffron/30">
          <CardContent className="p-5 text-sm text-ct-slate space-y-2">
            <p>{t.rich("howItWorksPoints", { b: (chunks) => <strong className="text-ct-navy">{chunks}</strong> })}</p>
            <p>{t.rich("howItWorksAchievements", { b: (chunks) => <strong className="text-ct-navy">{chunks}</strong> })}</p>
            <p>{t.rich("howItWorksStreaks", { b: (chunks) => <strong className="text-ct-navy">{chunks}</strong> })}</p>
            <p>{t.rich("howItWorksReferrals", { b: (chunks) => <strong className="text-ct-navy">{chunks}</strong> })}</p>
          </CardContent>
        </Card>
      )}

      {/* Points + streak summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-5">
            <p className="text-xs font-medium text-ct-muted uppercase tracking-wide">{t("pointsBalance")}</p>
            <p className="mt-1 font-heading text-3xl text-ct-navy">{summary.pointsBalance ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-5">
            <p className="text-xs font-medium text-ct-muted uppercase tracking-wide flex items-center gap-1">
              <Flame className="size-3.5 text-amber-500" /> {t("dailyStreak")}
            </p>
            <p className="mt-1 font-heading text-3xl text-ct-navy">{loginStreak?.currentCount ?? 0}</p>
            <p className="text-xs text-ct-muted mt-0.5">{t("longestDays", { count: loginStreak?.longestCount ?? 0 })}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-5">
            <p className="text-xs font-medium text-ct-muted uppercase tracking-wide">{t("achievementsUnlockedStat")}</p>
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
            <Trophy className="size-4 text-ct-saffron-text" /> {t("achievementsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {(summary.achievements ?? []).length === 0 ? (
            <p className="text-sm text-ct-muted">{t("noAchievements")}</p>
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
              <Share2 className="size-4 text-ct-saffron-text" /> {t("inviteEarnTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <p className="text-sm text-ct-muted">{t("inviteEarnSubtitle")}</p>
            {myLink ? (
              <div className="flex items-center gap-2">
                <input readOnly value={myLink} className="flex-1 rounded-md border border-ct-border bg-ct-cloud/40 px-3 py-2 text-xs text-ct-slate" />
                <Button size="sm" variant="outline" onClick={copyLink}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={generateLink} disabled={generating} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {generating ? t("generatingLink") : t("getReferralLink")}
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
              <Users className="size-4 text-ct-saffron-text" /> {t("teamLeaderboardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {(leaderboard ?? []).length === 0 ? (
              <p className="text-sm text-ct-muted">{t("noPointsYet")}</p>
            ) : (
              <div className="space-y-2">
                {(leaderboard ?? []).map((row, i) => (
                  <div key={row.userId} className="flex items-center gap-3">
                    <span className="w-4 text-xs font-semibold text-ct-muted">{i + 1}</span>
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-ct-navy text-white text-[10px] font-bold">{getInitials(row.name)}</AvatarFallback>
                    </Avatar>
                    <span className="flex-1 text-sm text-ct-navy truncate">{row.name}</span>
                    <span className="text-sm font-medium text-ct-saffron-text">{row.balance}</span>
                  </div>
                ))}
                {leaderboardHasMore && (
                  <Button size="sm" variant="ghost" onClick={loadMoreLeaderboard} disabled={loadingMoreLeaderboard} className="w-full text-ct-muted">
                    <ChevronDown className="size-3.5 mr-1" /> {loadingMoreLeaderboard ? t("loading") : t("showMore")}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Admin engagement report -- admin/manager only, 403 for anyone else
          means `report` stays null and this card simply doesn't render. */}
      {report && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-ct-navy">{t("engagementReportTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-ct-muted uppercase tracking-wide">{t("pointsAwarded")}</p>
                <p className="font-heading text-xl text-ct-navy">{report.totalPointsAwarded}</p>
              </div>
              <div>
                <p className="text-xs text-ct-muted uppercase tracking-wide">{t("pointsRedeemed")}</p>
                <p className="font-heading text-xl text-ct-navy">{report.totalPointsRedeemed}</p>
              </div>
              <div>
                <p className="text-xs text-ct-muted uppercase tracking-wide">{t("achievementUnlockRate")}</p>
                <p className="font-heading text-xl text-ct-navy">{Math.round(report.achievementUnlockRate * 100)}%</p>
                <p className="text-xs text-ct-muted">{t("unlocksActiveUsers", { unlocks: report.achievementUnlocksCount, users: report.activeUserCount })}</p>
              </div>
              <div>
                <p className="text-xs text-ct-muted uppercase tracking-wide">{t("referralConversionRate")}</p>
                <p className="font-heading text-xl text-ct-navy">{Math.round(report.referralConversionRate * 100)}%</p>
                <p className="text-xs text-ct-muted">{t("referralsConvertedCount", { converted: report.referralsConvertedCount, created: report.referralsCreatedCount })}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent activity */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="pb-2 flex-row items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold text-ct-navy">{t("recentActivityTitle")}</CardTitle>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-md border border-ct-border px-2 py-1 text-xs text-ct-slate"
              aria-label="Start date"
            />
            <span className="text-xs text-ct-muted">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-md border border-ct-border px-2 py-1 text-xs text-ct-slate"
              aria-label="End date"
            />
            <Button size="sm" variant="outline" onClick={applyDateFilter} disabled={loadingMoreHistory}>{t("filter")}</Button>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={exporting || historyTotal === 0}>
              <Download className="size-3.5 mr-1" /> {exporting ? t("exporting") : t("exportCsv")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {(history ?? []).length === 0 ? (
            <p className="text-sm text-ct-muted">{t("noActivity")}</p>
          ) : (
            <div className="space-y-2">
              {(history ?? []).map((h, i) => (
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
              {(history ?? []).length < historyTotal && (
                <Button size="sm" variant="ghost" onClick={loadMoreHistory} disabled={loadingMoreHistory} className="w-full text-ct-muted">
                  <ChevronDown className="size-3.5 mr-1" /> {loadingMoreHistory ? t("loading") : t("showMoreLeft", { count: historyTotal - (history ?? []).length })}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
