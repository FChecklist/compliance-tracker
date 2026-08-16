"use client";

export const dynamic = "force-dynamic";

// Wave 94 (Comparison CSV 3 gap analysis: AI011 "Prompt/Model Evaluation
// Framework"). veridian_admin-gated at the service layer (same authority bar
// as authoring a prompt version itself, Wave 22) -- this page is reachable by
// any signed-in user but write/run actions 403 for non-admins. Scoring is
// deterministic keyword containment against the platform's own configured
// API keys, never a customer's BYO key and never an LLM-judging-an-LLM call.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { FlaskConical, Plus, Loader2, Play, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PromptTemplateGroup = {
  templateKey: string; displayName: string;
  versions: { id: string; version: number; label: string | null; isActive: boolean }[];
};
type EvalCase = { id: string; name: string; userMessage: string; expectedKeywords: string[]; promptTemplateId: string };
type EvalRun = {
  id: string; provider: string; model: string; status: string; passed: boolean | null;
  missingKeywords: string[]; output: string | null; errorMessage: string | null;
  latencyMs: number | null; estimatedCostUsd: string | null; createdAt: string;
};

const PROVIDERS = ["openrouter", "groq", "openai", "anthropic", "google"];

export default function PromptEvalPage() {
  const [templates, setTemplates] = useState<PromptTemplateGroup[]>([]);
  const [templateKey, setTemplateKey] = useState<string>("");
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedCase, setSelectedCase] = useState<EvalCase | null>(null);
  const [runs, setRuns] = useState<EvalRun[]>([]);

  const [caseDialogOpen, setCaseDialogOpen] = useState(false);
  const [caseName, setCaseName] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [expectedKeywords, setExpectedKeywords] = useState("");
  const [creatingCase, setCreatingCase] = useState(false);

  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runVersionId, setRunVersionId] = useState("");
  const [runProvider, setRunProvider] = useState("openrouter");
  const [runModel, setRunModel] = useState("meta-llama/llama-3.3-70b-instruct");
  const [running, setRunning] = useState(false);

  const loadTemplates = useCallback(async () => {
    const res = await fetch("/api/settings/prompts");
    const data = await res.json();
    const groups: PromptTemplateGroup[] = data.templates ?? [];
    setTemplates(groups);
    if (!templateKey && groups.length > 0) setTemplateKey(groups[0].templateKey);
    setLoading(false);
  }, [templateKey]);

  const loadCases = useCallback(async () => {
    if (!templateKey) return;
    const res = await fetch(`/api/prompt-eval/cases?templateKey=${encodeURIComponent(templateKey)}`);
    setCases((await res.json()).cases ?? []);
  }, [templateKey]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useEffect(() => { loadCases(); }, [loadCases]);

  async function loadRuns(evalCase: EvalCase) {
    setSelectedCase(evalCase);
    const res = await fetch(`/api/prompt-eval/cases/${evalCase.id}/runs`);
    setRuns((await res.json()).runs ?? []);
  }

  async function createCase() {
    if (!caseName.trim() || !userMessage.trim() || !expectedKeywords.trim()) { toast.error("Name, user message, and expected keywords are required"); return; }
    setCreatingCase(true);
    const res = await fetch("/api/prompt-eval/cases", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateKey, name: caseName, userMessage,
        expectedKeywords: expectedKeywords.split(",").map((k) => k.trim()).filter(Boolean),
      }),
    });
    setCreatingCase(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to create eval case"); return; }
    toast.success("Eval case created");
    setCaseDialogOpen(false);
    setCaseName(""); setUserMessage(""); setExpectedKeywords("");
    loadCases();
  }

  function openRunDialog(evalCase: EvalCase) {
    setSelectedCase(evalCase);
    const group = templates.find((t) => t.templateKey === templateKey);
    setRunVersionId(group?.versions[0]?.id ?? "");
    setRunDialogOpen(true);
  }

  async function runEval() {
    if (!selectedCase || !runVersionId) return;
    setRunning(true);
    const res = await fetch(`/api/prompt-eval/cases/${selectedCase.id}/run`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptVersionId: runVersionId, provider: runProvider, model: runModel }),
    });
    setRunning(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Eval run failed"); return; }
    const run = await res.json();
    toast[run.status === "completed" && run.passed ? "success" : "error"](
      run.status === "error" ? `Eval errored: ${run.errorMessage}` : run.passed ? "Eval passed" : "Eval failed keyword check"
    );
    setRunDialogOpen(false);
    loadRuns(selectedCase);
  }

  const currentGroup = templates.find((t) => t.templateKey === templateKey);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2"><FlaskConical className="w-6 h-6" />Prompt &amp; Model Evaluation</h1>
        <p className="text-sm text-ct-muted mt-1">Run prompt versions against candidate models and score outputs by deterministic keyword containment. Uses only the platform's own configured API keys.</p>
      </div>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Select value={templateKey} onValueChange={setTemplateKey}>
              <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => <SelectItem key={t.templateKey} value={t.templateKey}>{t.displayName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Dialog open={caseDialogOpen} onOpenChange={setCaseDialogOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal/90"><Plus className="w-4 h-4 mr-1" />New Eval Case</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Eval Case for {currentGroup?.displayName}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Name</Label><Input value={caseName} onChange={(e) => setCaseName(e.target.value)} placeholder="e.g. Handles overdue-item nudge" /></div>
                  <div><Label>User Message</Label><Textarea rows={3} value={userMessage} onChange={(e) => setUserMessage(e.target.value)} placeholder="The user-turn content sent alongside the rendered prompt" /></div>
                  <div><Label>Expected Keywords (comma-separated, all must appear)</Label><Input value={expectedKeywords} onChange={(e) => setExpectedKeywords(e.target.value)} placeholder="deadline, overdue, action" /></div>
                </div>
                <DialogFooter><Button onClick={createCase} disabled={creatingCase}>{creatingCase ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Case"}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4 space-y-2">
                <h3 className="font-medium text-ct-navy text-sm">Eval Cases</h3>
                {cases.length === 0 ? <p className="text-xs text-ct-muted">No eval cases for this template yet.</p> : (
                  <ul className="space-y-2">
                    {cases.map((c) => (
                      <li key={c.id} className={`border border-ct-border rounded-lg p-3 cursor-pointer ${selectedCase?.id === c.id ? "bg-ct-row-hover" : ""}`} onClick={() => loadRuns(c)}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-ct-navy">{c.name}</span>
                          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openRunDialog(c); }}><Play className="w-3 h-3 mr-1" />Run</Button>
                        </div>
                        <p className="text-xs text-ct-muted mt-1">Keywords: {c.expectedKeywords.join(", ")}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4 space-y-2">
                <h3 className="font-medium text-ct-navy text-sm">Run History {selectedCase ? `— ${selectedCase.name}` : ""}</h3>
                {!selectedCase ? <p className="text-xs text-ct-muted">Select a case to view its run history.</p>
                  : runs.length === 0 ? <p className="text-xs text-ct-muted">No runs yet.</p> : (
                  <ul className="space-y-2 max-h-[420px] overflow-y-auto">
                    {runs.map((r) => (
                      <li key={r.id} className="border border-ct-border rounded-lg p-3 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-ct-navy">{r.provider} / {r.model}</span>
                          {r.status === "error" ? <Badge variant="outline">error</Badge>
                            : r.passed ? <Badge className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />passed</Badge>
                            : <Badge variant="outline" className="flex items-center gap-1"><XCircle className="w-3 h-3" />failed</Badge>}
                        </div>
                        {r.status === "error" ? <p className="text-ct-muted">{r.errorMessage}</p> : (
                          <>
                            {r.missingKeywords.length > 0 && <p className="text-ct-muted">Missing: {r.missingKeywords.join(", ")}</p>}
                            <p className="text-ct-muted">{r.latencyMs}ms{r.estimatedCostUsd ? ` · $${Number(r.estimatedCostUsd).toFixed(5)}` : ""}</p>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Run Eval: {selectedCase?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Prompt Version</Label>
              <Select value={runVersionId} onValueChange={setRunVersionId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currentGroup?.versions.map((v) => <SelectItem key={v.id} value={v.id}>v{v.version}{v.label ? ` (${v.label})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Provider</Label>
                <Select value={runProvider} onValueChange={setRunProvider}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PROVIDERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Model</Label><Input value={runModel} onChange={(e) => setRunModel(e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter><Button onClick={runEval} disabled={running || !runVersionId}>{running ? <Loader2 className="w-4 h-4 animate-spin" /> : "Run Eval"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
