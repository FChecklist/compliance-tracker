"use client";

// Bug fix (2026-07-06, found during the Demo Company E2E pass): this banner
// was entirely hardcoded to a fake trial window (Jan 2025 + 14 days) and
// completely ignored the real organisations.trial_ends_at column -- every
// org, regardless of actual plan or trial status, saw "trial ends in 0 days"
// once that fake window lapsed. Now reads the org's real trial_ends_at (via
// /api/me) and hides entirely for orgs with no trial window (e.g. paid plans,
// or a trial_ends_at of null).
import { useState } from "react";
import Link from "next/link";
import { Clock, AlertTriangle, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/queries/use-me";

export default function TrialBanner() {
  const [dismissed, setDismissed] = useState(false);
  // Shared react-query cache instead of its own /api/me fetch-on-mount.
  const { data: me } = useMe();

  const trial =
    me && me.orgPlan === "free" && me.trialEndsAt
      ? (() => {
          const diffMs = new Date(me.trialEndsAt!).getTime() - Date.now();
          const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
          return { daysRemaining, isWarning: daysRemaining <= 4 };
        })()
      : null;

  if (!trial || dismissed) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl text-sm transition-colors mb-4",
        trial.isWarning
          ? "bg-amber-50 border border-amber-200"
          : "bg-ct-teal/5 border border-ct-teal/20"
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {trial.isWarning ? (
          <AlertTriangle className="size-4 text-amber-600 shrink-0" />
        ) : (
          <Clock className="size-4 text-ct-teal shrink-0" />
        )}
        <p
          className={cn(
            "text-sm truncate",
            trial.isWarning ? "text-amber-800 font-medium" : "text-ct-navy"
          )}
        >
          {trial.isWarning ? (
            <>
              Your trial ends in <strong>{trial.daysRemaining} day{trial.daysRemaining !== 1 ? "s" : ""}</strong>.
              Upgrade to continue.
            </>
          ) : (
            <>
              You&apos;re on a free trial.{" "}
              <strong>{trial.daysRemaining} day{trial.daysRemaining !== 1 ? "s" : ""}</strong> remaining.
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link href="/pricing">
          <Button
            size="sm"
            className={cn(
              "text-xs font-semibold px-3 h-7",
              trial.isWarning
                ? "bg-amber-600 hover:bg-amber-700 text-white"
                : "bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
            )}
          >
            Upgrade Now
            <ArrowRight className="size-3 ml-1.5" />
          </Button>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-ct-muted hover:text-ct-navy"
          onClick={() => setDismissed(true)}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
