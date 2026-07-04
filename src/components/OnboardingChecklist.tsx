"use client";

import { useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { UserCheck, FileText, Upload, Users, Brain, X, PartyPopper, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "veridian_onboarding_steps";

const STEPS = [
  { id: "profile", label: "Complete your profile", icon: UserCheck },
  { id: "compliance", label: "Add your first compliance item", icon: FileText },
  { id: "upload", label: "Upload a document", icon: Upload },
  { id: "invite", label: "Invite a team member", icon: Users },
  { id: "ai-config", label: "Set up AI configuration", icon: Brain },
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
              <h3 className="text-sm font-semibold text-ct-navy">
                Get Started with VERIDIAN AI
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