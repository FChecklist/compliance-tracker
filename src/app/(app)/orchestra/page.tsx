import { Bot, ListChecks, CircleCheck, Clock, Sparkles, Info } from "lucide-react";
import { AssistantColumn } from "@/components/orchestra/AssistantColumn";
import { AgentLibrarySheet } from "@/components/orchestra/AgentLibrarySheet";
import { ASSISTANTS, TIER_COLOR, TIER_LABEL, type AgentTier } from "@/lib/orchestra-mock-data";
import { cn } from "@/lib/utils";

const TIERS: AgentTier[] = ["global", "firm", "client", "user"];

export default function OrchestraPage() {
  const totalTasks = ASSISTANTS.reduce((sum, a) => sum + a.tasks.length, 0);
  const submitted = ASSISTANTS.reduce((sum, a) => sum + a.tasks.filter((t) => t.status === "submitted").length, 0);
  const inReview = ASSISTANTS.reduce((sum, a) => sum + a.tasks.filter((t) => t.status === "completed").length, 0);

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2">
            VERIDIAN AI Orchestra
            <span className="text-[10px] font-sans font-semibold text-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800">
              Preview
            </span>
          </h1>
          <p className="text-sm text-ct-muted mt-1">
            Where this is headed: 5 AI assistants per user, orchestrating a 4-tier worker agent
            library across every client you service.
          </p>
        </div>
        <AgentLibrarySheet />
      </div>

      {/* What's real vs. what's coming */}
      <div className="flex items-start gap-2.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 px-3.5 py-3">
        <Info className="size-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
        <p className="text-xs text-indigo-900 dark:text-indigo-200 leading-relaxed">
          <strong>Mixed real/preview page.</strong> Click <strong>Agent Library</strong> above to see
          your real worker agents — that data is live from the database (Wave 3), RLS-enforced per
          tier. The 5 assistant columns below are still example content: your real 5 assistants
          exist (Wave 2, editable in Settings → AI Assistants) but the tasks and chat shown per
          column are illustrative, since nothing creates real tasks for them yet. Chat input and
          task submission stay disabled here rather than faked. See{" "}
          <span className="font-mono">orchestra_changes.md</span> for exactly what's real vs. planned.
        </p>
      </div>

      {/* Summary stats */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        <div className="flex items-center gap-1.5 text-xs text-ct-muted">
          <Bot className="size-3.5 text-indigo-600" />
          <strong className="text-ct-navy font-semibold">{ASSISTANTS.length}</strong> Assistants
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ct-muted">
          <ListChecks className="size-3.5 text-amber-600" />
          <strong className="text-ct-navy font-semibold">{totalTasks}</strong> Tasks
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ct-muted">
          <CircleCheck className="size-3.5 text-lime-600" />
          <strong className="text-ct-navy font-semibold">{submitted}</strong> Done
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ct-muted">
          <Clock className="size-3.5 text-rose-600" />
          <strong className="text-ct-navy font-semibold">{inReview}</strong> Review
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
        {ASSISTANTS.map((assistant) => (
          <AssistantColumn key={assistant.id} assistant={assistant} />
        ))}
      </div>

      {/* Missing pieces roadmap */}
      <div className="rounded-lg border bg-card px-4 py-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles className="size-3.5 text-ct-saffron" />
          <span className="text-sm font-semibold text-ct-navy">What's not built yet</span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs text-ct-muted">
          <RoadmapItem wave="Wave 1" label="Real tenant hierarchy (Customer Account → Client → Client Entity) + enforced Row Level Security" />
          <RoadmapItem wave="Wave 2" label="ai_assistants, assistant_memories tables — assistants shown here don't persist or remember anything yet" />
          <RoadmapItem wave="Wave 3" label="worker_agents table across 4 tiers — today's 7 real MCP tools become the first Global-tier seed" />
          <RoadmapItem wave="Wave 4" label="tasks, task_execution_plan, orchestra_layers — real task orchestration and per-layer BYO model routing" />
          <RoadmapItem wave="Wave 5" label="15 self-improvement loops — starting with audit/safety loops before any generative ones" />
          <RoadmapItem wave="Wave 6" label="Hardening + launch reconciliation against the existing test suite" />
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
