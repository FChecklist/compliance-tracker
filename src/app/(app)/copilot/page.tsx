"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA merge, module 19/24 (GAP-CONSTR): AI Copilot quick-launch for the
// 7 construction-specific codeReferences registered in capability-tree-
// service.ts's buildConstructionNodes() (Wave 128) -- ported from PROJEXA's
// own page.tsx (thin server component) + CopilotClient.tsx (165 lines).
// This repo's established pattern for a single-component module (see
// rfis/page.tsx, change-orders/page.tsx) collapses PROJEXA's server/client
// split into one client page that owns its own project selection via
// ProjectPicker/NoProjectsCard + /api/projects, so that split is not
// reproduced here.
//
// Backing API: POST /api/v1/projexa/assistant (src/app/api/v1/projexa/
// assistant/route.ts) -- read in full before writing this page. It takes
// { codeReference, inputs } and returns { codeReference, result } directly;
// inputs.projectId is the exact key construction-tools.ts's dispatch
// switch reads for every project-scoped codeReference (verified in
// src/lib/task-execution/construction-tools.ts).
//
// SCOPE DECISION: PROJEXA's own CopilotClient.tsx also loads "Recent
// Construction Queries" via `GET /api/assistant`, against PROJEXA's OWN
// local query-log table (code_reference/breadcrumb/status/result/
// error_message columns). This repo's /api/v1/projexa/assistant route has
// no GET handler and no equivalent table -- confirmed by reading that
// route file in full (POST only, 85 lines) and grepping schema.ts for a
// table shaped like PROJEXA's QueryRow (no match). Rather than fabricate a
// fetch against an endpoint that does not exist, history below is tracked
// client-side/session-only as each tool is actually run. PROJEXA's own
// code comment there (~line 51) documents a real prior bug where that GET
// call's `res.ok` was left unread, silently swallowing a failed fetch --
// there is no GET here to reintroduce that bug on, but the POST dispatch
// below (the half of that file already fixed, per the same comment) still
// checks `res.ok` explicitly, so that bug class is not reintroduced here
// either.
//
// Also dropped: PROJEXA's useVeriChat()/"Open Discuss" button. This repo's
// own VeriChat (src/components/veri-chat/veri-chat-context.tsx) only mounts
// for veriChatV2Enabled orgs (see that file's own comment on
// VeriChatProvider), and no other ported module reaches into it -- out of
// scope for a small, single-endpoint port.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, LayoutDashboard, Clock, Wallet, AlertTriangle, Target, FileText, ShieldAlert, Bot } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type Tool = {
  codeReference: string;
  label: string;
  icon: typeof LayoutDashboard;
  needsProject: boolean;
  description: string;
};

const TOOLS: Tool[] = [
  { codeReference: "get_construction_project_dashboard", label: "Project Dashboard", icon: LayoutDashboard, needsProject: true, description: "Budget, revenue, expenses, progress for this project" },
  { codeReference: "get_construction_budget_status", label: "Budget Status", icon: Wallet, needsProject: true, description: "Budget vs actual for this project" },
  { codeReference: "get_construction_kpi_status", label: "KPI Status", icon: Target, needsProject: true, description: "KPI definitions vs actuals for this project" },
  { codeReference: "generate_construction_progress_summary", label: "AI Progress Summary", icon: FileText, needsProject: true, description: "AI-generated summary of recent progress" },
  { codeReference: "detect_construction_budget_schedule_risk", label: "AI Budget/Schedule Risk", icon: ShieldAlert, needsProject: true, description: "AI risk flags for budget and schedule" },
  { codeReference: "list_delayed_activities", label: "Delayed Activities", icon: Clock, needsProject: false, description: "Every project (org-wide) with a delayed task" },
  { codeReference: "list_over_budget_projects", label: "Over-Budget Projects", icon: AlertTriangle, needsProject: false, description: "Every project (org-wide) running over budget" },
];

type HistoryEntry = { id: string; tool: Tool; status: "done" | "error"; message?: string; at: Date };

export default function CopilotPage() {
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [running, setRunning] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ tool: Tool; result: unknown } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: PickerProject[] = d.projects ?? [];
        setProjects(list);
        if (list.length > 0) setProjectId((prev) => prev || list[0].id);
      })
      .catch(() => toast.error("Failed to load projects"))
      .finally(() => setLoadingProjects(false));
  }, []);

  const runTool = useCallback(async (tool: Tool) => {
    if (tool.needsProject && !projectId) {
      toast.error("Choose a project first");
      return;
    }
    setRunning(tool.codeReference);
    try {
      const res = await fetch("/api/v1/projexa/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codeReference: tool.codeReference,
          inputs: tool.needsProject ? { projectId } : {},
        }),
      });
      const row = await res.json().catch(() => null);
      if (!res.ok) throw new Error(row?.error ?? `Failed to run ${tool.label}`);
      toast.success(`Done -- ${tool.label}`);
      setLastResult({ tool, result: row.result });
      setHistory((prev) => [
        { id: `${tool.codeReference}-${Date.now()}`, tool, status: "done" as const, at: new Date() },
        ...prev,
      ].slice(0, 20));
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : `Couldn't run ${tool.label}`;
      toast.error(message);
      setHistory((prev) => [
        { id: `${tool.codeReference}-${Date.now()}`, tool, status: "error" as const, message, at: new Date() },
        ...prev,
      ].slice(0, 20));
    } finally {
      setRunning(null);
    }
  }, [projectId]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">AI Copilot</h1>
        <p className="text-sm text-ct-muted mt-1">Quick-launch for the 7 construction AI tools -- run one and see the result inline.</p>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={Bot} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              const isRunning = running === tool.codeReference;
              return (
                <Card key={tool.codeReference} className="rounded-xl shadow-card bg-white">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center gap-2 font-medium text-ct-navy"><Icon className="size-4" />{tool.label}</div>
                    <p className="text-xs text-ct-muted">{tool.description}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => runTool(tool)}
                      disabled={running !== null || (tool.needsProject && !projectId)}
                    >
                      {isRunning ? <Loader2 className="size-4 animate-spin" /> : "Run"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {lastResult && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base">Result -- {lastResult.tool.label}</CardTitle></CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-lg bg-ct-cloud p-3 text-xs whitespace-pre-wrap break-words text-ct-navy">
              {JSON.stringify(lastResult.result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base">This Session&apos;s Queries</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-6 text-center text-sm text-ct-muted">No queries run yet this session -- run one above.</p>
          ) : (
            <div className="space-y-2">
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between rounded-lg border border-ct-border px-3 py-2 text-sm">
                  <span className="text-ct-navy">{h.tool.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ct-muted">{h.at.toLocaleTimeString()}</span>
                    <Badge variant={h.status === "done" ? "default" : "destructive"}>{h.status}</Badge>
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
