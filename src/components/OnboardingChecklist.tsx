"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { UserCheck, FileText, Users, Brain, X, PartyPopper, ChevronDown, ChevronUp, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "veridian_onboarding_steps";

// U-D28 (Onboarding & Sign-up UX): "Set up AI configuration" and "Upload a
// document" were removed from this mandatory checklist per the source
// requirement (ai-os/audit-tree/09-onboarding-ux.yaml, "Changes part 1" --
// "Remove 'Set up AI configuration' as a top-level/onboarding item -- it
// confuses users. Relocate ... into Settings instead" and "Remove the
// 'Upload the document' onboarding step entirely"). AI configuration
// already lives in Settings > AI Configuration (see
// src/app/(app)/settings/page.tsx, SETTINGS_NAV "ai-config" entry) -- it
// was never removed from the app, only from this blocking onboarding flow.
// Document upload has no relocation target per the source doc; it is
// discoverable organically once a user is working with compliance items.
//
// D28.B1.S1 (2026-07-11): the "compliance" step's label used to read "Add
// your first compliance item" -- the exact "first compliance Item" phrasing
// the source doc names as the framing to stop using ("VERIDIAN AI is no
// longer a compliance tool -- don't use 'first compliance Item' as the
// framing", ai-os/audit-tree/09-onboarding-ux.yaml). Reworded to describe
// the action VERI takes, not the compliance-first identity of the product;
// the step's `id` is unchanged so it stays wired to the same completion
// tracking (/api/me/onboarding-stage).
// subagent/audit-lifecycle (tree4-unified/50-completion-plan Priority 2 item
// 3, D28/U-D28.B1.S1's "connectors pre-connected during setup" clause):
// confirmed on direct verification that no onboarding step touched
// connectors at all (grepped OnboardingChecklist.tsx for "connector",
// zero matches) -- this is a real, narrow gap distinct from the two
// U-D28.B1.S1 asks already ratified out-of-scope this session (no-typing
// profile inference, the auth/Mode-Pill redesign). True automatic
// "pre-connection" isn't possible (OAuth requires the user to authenticate
// with the third party) -- autoDetected here means the step reflects REAL
// connection status fetched from GET /api/connectors (see the effect
// below), not a manual, unverified checkbox claiming something happened
// that didn't. Clicking it navigates to /connectors rather than toggling a
// local flag, since ticking this box by hand would be exactly the kind of
// fabricated completion state this codebase's own discipline refuses
// elsewhere.
const STEPS = [
  { id: "profile", label: "Complete your profile", icon: UserCheck, autoDetected: false },
  { id: "compliance", label: "Give VERI its first task", icon: FileText, autoDetected: false },
  { id: "connectors", label: "Connect your tools", icon: Plug, autoDetected: true },
  { id: "invite", label: "Invite a team member", icon: Users, autoDetected: false },
];

function readStorage(): { completed: string[]; dismissed: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { completed?: string[]; dismissed?: boolean };
      return { completed: parsed.completed ?? [], dismissed: parsed.dismissed ?? false };
    }
  } catch {
    // ignore
  }
  return { completed: [], dismissed: false };
}

function writeStorage(completed: string[], dismissed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ completed, dismissed }));
  } catch {
    // ignore
  }
}

export default function OnboardingChecklist() {
  const router = useRouter();
  const [completedArr, setCompletedArr] = useState<string[]>(() => readStorage().completed);
  const [dismissed, setDismissed] = useState<boolean>(() => readStorage().dismissed);
  const [collapsed, setCollapsed] = useState(false);
  const [autoDismissed, setAutoDismissed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const completed = new Set(completedArr);
  const allDone = completed.size === STEPS.length;
  const progress = (completed.size / STEPS.length) * 100;

  // showCongrats is derived: all done, not dismissed by user, not auto-dismissed
  const showCongrats = allDone && !dismissed && !autoDismissed;

  const toggleStep = useCallback((id: string) => {
    setCompletedArr((prev) => {
      const alreadyDone = prev.includes(id);
      const next = alreadyDone ? prev.filter((s) => s !== id) : [...prev, id];
      const isNowAllDone = next.length === STEPS.length;
      writeStorage(next, false);
      // If all steps just completed, schedule congrats auto-dismiss
      if (isNowAllDone && !alreadyDone) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setAutoDismissed(true);
          writeStorage(next, true);
          setDismissed(true);
        }, 5000);
      }
      return next;
    });
    // Sync server-side alongside the existing localStorage write
    fetch('/api/me/onboarding-stage', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: id }),
    });
  }, []);

  // Marks a step complete WITHOUT the toggle-off branch toggleStep has --
  // used only by the connectors auto-detection effect below, since a step
  // reflecting real, externally-verified state shouldn't flip back to
  // incomplete just because this component re-ran (it already didn't flip
  // back to complete on its own either -- only a real GET /api/connectors
  // result does that).
  const markStepComplete = useCallback((id: string) => {
    setCompletedArr((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      writeStorage(next, false);
      return next;
    });
    fetch('/api/me/onboarding-stage', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: id }),
    });
  }, []);

  // Real connection-status check, not a manual claim -- see STEPS' own
  // comment for why "connectors" is autoDetected. Runs once on mount; if
  // the user connects a tool later and returns, the step catches up next
  // time this component mounts (no polling -- consistent with this
  // component's existing no-realtime-sync posture for every other step).
  useEffect(() => {
    if (completed.has("connectors")) return; // already known complete, skip the check
    let cancelled = false;
    fetch("/api/connectors")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { toolkits?: { connected: boolean }[] } | null) => {
        if (cancelled || !data?.toolkits) return;
        if (data.toolkits.some((t) => t.connected)) markStepComplete("connectors");
      })
      .catch(() => { /* best-effort -- an onboarding nudge, never blocking */ });
    return () => { cancelled = true; };
  }, []);

  const handleDismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    writeStorage(completedArr, true);
    setDismissed(true);
  }, [completedArr]);

  if (dismissed) return null;

  if (showCongrats) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <Card className="rounded-xl border-2 border-ct-teal bg-ct-success-light overflow-hidden">
          <CardContent className="p-6 text-center">
            <div className="inline-flex items-center justify-center size-12 rounded-full bg-ct-teal/10 mb-3">
              <PartyPopper className="size-6 text-ct-teal" />
            </div>
            <h3 className="font-heading text-xl text-ct-navy">
              Congratulations! 🎉
            </h3>
            <p className="text-sm text-ct-muted mt-2">
              You&apos;ve completed all onboarding steps. You&apos;re all set to use VERIDIAN AI!
            </p>
            <Button
              variant="ghost"
              onClick={handleDismiss}
              className="mt-4 text-sm text-ct-muted hover:text-ct-navy"
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <Card className="rounded-xl shadow-card bg-white border border-ct-saffron/30 mb-6 overflow-hidden">
      <CardContent className="p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-ct-accent/50">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-ct-saffron/10 flex items-center justify-center">
              <Brain className="size-4 text-ct-saffron" />
            </div>
            <div>
              {/* D28.B1.S1: was "Get Started with VERIDIAN AI" -- the exact
                  CTA the source doc names for replacement, since it framed
                  the product as a tool to get started WITH rather than an
                  assistant that works alongside the user. Reworded to match
                  the AI-assistant identity used elsewhere (e.g. home/page.tsx's
                  "I'm VERI, your assistant"), without inventing new product
                  copy this session didn't verify against a canonical source. */}
              <h3 className="text-sm font-semibold text-ct-navy">
                Get Set Up with VERI, Your AI Assistant
              </h3>
              <p className="text-xs text-ct-muted">
                {completed.size} of {STEPS.length} steps completed
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ct-saffron">{Math.round(progress)}%</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-ct-muted hover:text-ct-navy"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronUp className="size-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-ct-muted hover:text-ct-navy"
              onClick={handleDismiss}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="px-4 pt-3">
          <Progress value={progress} className="h-1.5" />
        </div>

        {/* Steps */}
        {!collapsed && (
          <div className="p-4 space-y-1">
            {STEPS.map((step) => {
              const isCompleted = completed.has(step.id);
              // autoDetected steps (currently: "connectors") reflect real,
              // externally-verified state -- clicking navigates to where
              // that state is actually set, rather than letting the user
              // hand-claim completion the way the other steps allow.
              if (step.autoDetected) {
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => router.push("/connectors")}
                    className={cn(
                      "flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors hover:bg-ct-cloud/60 w-full text-left",
                      isCompleted && "opacity-60"
                    )}
                  >
                    <div
                      className={cn(
                        "size-4 shrink-0 rounded border flex items-center justify-center",
                        isCompleted ? "bg-ct-teal border-ct-teal" : "border-ct-muted"
                      )}
                      aria-hidden
                    >
                      {isCompleted && <span className="size-1.5 rounded-full bg-white" />}
                    </div>
                    <step.icon
                      className={cn(
                        "size-4 shrink-0",
                        isCompleted ? "text-ct-teal" : "text-ct-muted"
                      )}
                    />
                    <span
                      className={cn(
                        "text-sm transition-colors",
                        isCompleted
                          ? "text-ct-muted line-through"
                          : "text-ct-navy font-medium"
                      )}
                    >
                      {step.label}
                    </span>
                    {!isCompleted && (
                      <span className="ml-auto text-[11px] text-ct-saffron font-medium">Connect &rarr;</span>
                    )}
                  </button>
                );
              }
              return (
                <label
                  key={step.id}
                  className={cn(
                    "flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors hover:bg-ct-cloud/60",
                    isCompleted && "opacity-60"
                  )}
                >
                  <Checkbox
                    checked={isCompleted}
                    onCheckedChange={() => toggleStep(step.id)}
                    className="data-[state=checked]:bg-ct-teal data-[state=checked]:border-ct-teal"
                  />
                  <step.icon
                    className={cn(
                      "size-4 shrink-0",
                      isCompleted ? "text-ct-teal" : "text-ct-muted"
                    )}
                  />
                  <span
                    className={cn(
                      "text-sm transition-colors",
                      isCompleted
                        ? "text-ct-muted line-through"
                        : "text-ct-navy font-medium"
                    )}
                  >
                    {step.label}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}