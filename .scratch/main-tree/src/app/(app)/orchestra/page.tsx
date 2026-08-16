"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Sparkles, Info, Activity } from "lucide-react";
import { RealAssistantColumn } from "@/components/orchestra/RealAssistantColumn";
import { AgentLibrarySheet } from "@/components/orchestra/AgentLibrarySheet";
import { TIER_COLOR, TIER_LABEL, type AgentTier } from "@/lib/orchestra-mock-data";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TIERS: AgentTier[] = ["global", "firm", "client", "user"];

type RealAssistant = {
  id: string;
  assistantNumber: number;
  label: string;
  status: "idle" | "working";
};

export default function OrchestraPage() {
  const [assistants, setAssistants] = useState<RealAssistant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/assistants")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setAssistants(data.assistants ?? []))
      .catch(() => setAssistants([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2">
            VERIDIAN AI Orchestra
          </h1>
          <p className="text-sm text-ct-muted mt-1">
            Your 5 AI assistants, orchestrating a 4-tier worker agent library across every client
            you service.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/orchestra/analytics"><Activity className="w-4 h-4 mr-1" />Analytics</Link>
          </Button>
          <AgentLibrarySheet />
        </div>
      </div>

      {/* What's real vs. what's coming */}
      <div className="flex items-start gap-2.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 px-3.5 py-3">
        <Info className="size-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
        <p className="text-xs text-indigo-900 dark:text-indigo-200 leading-relaxed">
          <strong>This page is fully live.</strong> The 5 columns below are your real assistants
          (Wave 2), the Agent Library is your real worker agent roster (Wave 3), and adding a task
          to a column plans it against your real agents and reports back (Wave 4's execution
          engine) — the plan and the assistant&apos;s response are both real rows you can see
          persist. See <span className="font-mono">orchestra_changes.md</span> for exactly what's
          built vs. planned.
        </p>
      </div>

      {/* Tier legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        <div className="flex items-center gap-1.5 text-xs text-ct-muted">
          <Bot className="size-3.5 text-indigo-600" />
          <strong className="text-ct-navy font-semibold">{assistants.length}</strong> Assistants
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-[11px] text-ct-muted">
          {TIERS.map((tier) => {
            const c = TIER_COLOR[tier];
            return (
              <span key={tier} className="flex items-center gap-1">
                <span className={cn("size-1.5 rounded-full", c.dot)} />
                {TIER_LABEL[tier]}
              </span>
            );
          })}
        </div>
      </div>

      {/* Assistant columns */}
      <div className="flex-1 flex gap-3 overflow-x-auto pb-2 min-h-[520px]">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="flex-1 min-w-[260px] h-full" />
          ))
        ) : assistants.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-ct-muted">
            No assistants found. They're auto-provisioned on signup — try refreshing.
          </div>
        ) : (
          assistants.map((assistant) => (
            <RealAssistantColumn key={assistant.id} assistant={assistant} />
          ))
        )}
      </div>

      {/* Missing pieces roadmap */}
      <div className="rounded-lg border bg-card px-4 py-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles className="size-3.5 text-ct-saffron" />
          <span className="text-sm font-semibold text-ct-navy">What's not built yet</span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs text-ct-muted">
          <RoadmapItem wave="Wave 4" label="Worker agent dispatch — the execution engine plans against real agents but doesn't invoke their underlying logic yet, only records the plan" />
          <RoadmapItem wave="Wave 4" label="Generalizing the ingestion pipeline into the tasks model — deliberately deferred, it's a refactor of a live feature" />
          <RoadmapItem wave="Wave 5" label="9 more self-improvement loops — 6 audit loops active so far (#8, #9, #10, #11, #12, #14)" />
          <RoadmapItem wave="Wave 5" label="Self-Coding and Prompt Management loops — explicitly deferred until the audit loops have a track record" />
          <RoadmapItem wave="Wave 6" label="Live load-testing — blocked on a Supabase connection pooler issue, see orchestra_changes.md" />
        </div>
      </div>
    </div>
  );
}

function RoadmapItem({ wave, label }: { wave: string; label: string }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 font-mono text-[10px] font-semibold text-ct-saffron bg-ct-cloud px-1.5 py-0.5 rounded h-fit">
        {wave}
      </span>
      <span className="leading-snug">{label}</span>
    </div>
  );
}
