"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, AlertTriangle, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Demo flag — in production, this would check org.trialEndsAt from the backend
const DEMO_TRIAL_ENABLED = true;
const DEMO_TRIAL_START = new Date("2025-01-20");
const DEMO_TRIAL_DURATION_DAYS = 14;

function computeTrialState() {
  if (!DEMO_TRIAL_ENABLED) return null;

  const end = new Date(DEMO_TRIAL_START);
  end.setDate(end.getDate() + DEMO_TRIAL_DURATION_DAYS);

  const now = new Date();
  const diffMs = end.getTime() - now.getTime();
  const diffDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  return { daysRemaining: diffDays, isWarning: diffDays <= 4 };
}

export default function TrialBanner() {
  const [dismissed, setDismissed] = useState(false);
  const trial = computeTrialState();

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
              You&apos;re on a <strong>14-day free trial</strong>.{" "}
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