"use client";

export const dynamic = "force-dynamic";

// Wave 89 (Comparison CSV 2 gap analysis: BCM Business Impact Analysis +
// Recovery Plan detail + Exercise log). Replaces the generic SimpleModulePage
// (bare name/last-tested/status CRUD) with a list+detail view once a plan
// needs real BIA/recovery-procedure/exercise-history detail -- the same
// "outgrows generic CRUD" pattern erp/contracts and erp/inventory-planning
// already went through.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { ShieldAlert, Plus, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Plan = { id: string; planName: string; lastTestedDate: string | null; status: string };
type Bia = { id: string; businessProcessName: string; impactDescription: string | null; rtoHours: string | null; rpoHours: string | null; criticalityLevel: string };
type RecoveryStep = { id: string; stepNumber: number; description: string; estimatedDurationMinutes: string | null };
type Exercise = { id: string; exerciseDate: string; exerciseType: string; outcome: string; findings: string | null };
type PlanDetail = Plan & { businessImpactAnalyses: Bia[]; recoveryProcedures: RecoveryStep[]; exercises: Exercise[] };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  not_tested: "outline", tested_passed: "default", tested_failed: "secondary", tested_with_findings: "secondary",
};
const CRITICALITY_VARIANT: Record<string, "default" | "secondary" | "outline"> = { low: "outline", medium: "secondary", high: "default", critical: "default" };

export default function BcmPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlanDetail | null>(null);

  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [planName, setPlanName] = useState("");
  const [creatingPlan, setCreatingPlan] = useState(false);

  const [biaProcess, setBiaProcess] = useState("");
  const [biaRto, setBiaRto] = useState("");
  const [biaRpo, setBiaRpo] = useState("");
  const [biaCriticality, setBiaCriticality] = useState("medium");

  const [stepDesc, setStepDesc] = useState("");
  const [stepDuration, setStepDuration] = useState("");

  const [exerciseDate, setExerciseDate] = useState(new Date().toISOString().slice(0, 10));
  const [exerciseType, setExerciseType] = useState("tabletop");
  const [exerciseOutcome, setExerciseOutcome] = useState("passed");
  const [exerciseFindings, setExerciseFindings] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/bcm");
    setPlans((await res.json()).plans ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadDetail(id: string) {
    setSelectedId(id);
    const res = await fetch(`/api/bcm/${id}`);
    setDetail(res.ok ? await res.json() : null);
  }

  async function createPlan() {
    if (!planName.trim()) { toast.error("Plan name is required"); return; }
    setCreatingPlan(true);
    const res = await fetch("/api/bcm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planName }) });
    setCreatingPlan(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to create plan"); return; }
    toast.success("BCM plan created");
    setPlanDialogOpen(false);
    setPlanName("");
    load();
  }

  async function addBia() {
    if (!selectedId || !biaProcess.trim()) { toast.error("Business process name is required"); return; }
    const res = await fetch(`/api/bcm/${selectedId}/bia`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessProcessName: biaProcess, rtoHours: biaRto ? Number(biaRto) : undefined, rpoHours: biaRpo ? Number(biaRpo) : undefined, criticalityLevel: biaCriticality }),
    });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to add BIA entry"); return; }
    setBiaProcess(""); setBiaRto(""); setBiaRpo("");
    loadDetail(selectedId);
  }

  async function addStep() {
    if (!selectedId || !stepDesc.trim()) { toast.error("Description is required"); return; }
    const res = await fetch(`/api/bcm/${selectedId}/recovery-procedures`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: stepDesc, estimatedDurationMinutes: stepDuration ? Number(stepDuration) : undefined }),
    });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to add recovery step"); return; }
    setStepDesc(""); setStepDuration("");
    loadDetail(selectedId);
  }

  async function logExercise() {
    if (!selectedId || !exerciseDate) { toast.error("Exercise date is required"); return; }
    const res = await fetch(`/api/bcm/${selectedId}/exercises`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exerciseDate, exerciseType, outcome: exerciseOutcome, findings: exerciseFindings || undefined }),
    });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to log exercise"); return; }
    toast.success("Exercise logged");
    setExerciseFindings("");
    loadDetail(selectedId);
    load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2"><ShieldAlert className="w-6 h-6" />Business Continuity</h1>
        <p className="text-sm text-ct-muted mt-1">Continuity plans — business impact analysis, recovery procedures, and exercise/drill history.</p>
      </div>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <>
          <div className="flex justify-end mb-2">
            <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal/90"><Plus className="w-4 h-4 mr-1" />New Plan</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New BCM Plan</DialogTitle></DialogHeader>
                <div><Label>Plan Name</Label><Input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="e.g. Data Center Failover Plan" /></div>
                <DialogFooter><Button onClick={createPlan} disabled={creatingPlan}>{creatingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Plan"}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Plan</th><th className="p-3 font-medium">Last Tested</th><th className="p-3 font-medium">Status</th></tr></thead>
                  <tbody className="divide-y divide-ct-border">
                    {plans.length === 0 ? <tr><td colSpan={3} className="p-6 text-center text-ct-muted">No continuity plans yet.</td></tr>
                      : plans.map((p) => (
                        <tr key={p.id} className={`hover:bg-ct-row-hover cursor-pointer ${selectedId === p.id ? "bg-ct-row-hover" : ""}`} onClick={() => loadDetail(p.id)}>
                          <td className="p-3">{p.planName}</td>
                          <td className="p-3">{p.lastTestedDate ? new Date(p.lastTestedDate).toLocaleDateString("en-IN") : "Not tested"}</td>
                          <td className="p-3"><Badge variant={STATUS_VARIANT[p.status] ?? "outline"}>{p.status.replaceAll("_", " ")}</Badge></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4">
                {!selectedId || !detail ? (
                  <p className="text-sm text-ct-muted">Select a plan to view its business impact analysis, recovery procedures, and exercise history.</p>
                ) : (
                  <div className="space-y-4">
                    <h3 className="font-medium text-ct-navy">{detail.planName}</h3>

                    <div>
                      <h4 className="text-xs font-medium text-ct-muted mb-1">Business Impact Analysis</h4>
                      <div className="flex flex-wrap gap-2 mb-2">
                        <Input placeholder="Business process" value={biaProcess} onChange={(e) => setBiaProcess(e.target.value)} className="flex-1 min-w-[140px]" />
                        <Input type="number" placeholder="RTO (hrs)" value={biaRto} onChange={(e) => setBiaRto(e.target.value)} className="w-24" />
                        <Input type="number" placeholder="RPO (hrs)" value={biaRpo} onChange={(e) => setBiaRpo(e.target.value)} className="w-24" />
                        <Select value={biaCriticality} onValueChange={setBiaCriticality}>
                          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
                        </Select>
                        <Button size="sm" onClick={addBia}><Plus className="w-3 h-3" /></Button>
                      </div>
                      <ul className="space-y-1 text-xs">
                        {detail.businessImpactAnalyses.length === 0 ? <li className="text-ct-muted">None recorded.</li> : detail.businessImpactAnalyses.map((b) => (
                          <li key={b.id} className="flex items-center justify-between">
                            <span>{b.businessProcessName} — RTO {b.rtoHours ?? "—"}h / RPO {b.rpoHours ?? "—"}h</span>
                            <Badge variant={CRITICALITY_VARIANT[b.criticalityLevel] ?? "outline"}>{b.criticalityLevel}</Badge>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h4 className="text-xs font-medium text-ct-muted mb-1">Recovery Procedures</h4>
                      <div className="flex gap-2 mb-2">
                        <Input placeholder="Step description" value={stepDesc} onChange={(e) => setStepDesc(e.target.value)} className="flex-1" />
                        <Input type="number" placeholder="Minutes" value={stepDuration} onChange={(e) => setStepDuration(e.target.value)} className="w-24" />
                        <Button size="sm" onClick={addStep}><Plus className="w-3 h-3" /></Button>
                      </div>
                      <ol className="space-y-1 text-xs list-decimal list-inside">
                        {detail.recoveryProcedures.length === 0 ? <li className="text-ct-muted list-none">None recorded.</li> : detail.recoveryProcedures.map((s) => (
                          <li key={s.id}>{s.description}{s.estimatedDurationMinutes ? ` (${s.estimatedDurationMinutes} min)` : ""}</li>
                        ))}
                      </ol>
                    </div>

                    <div>
                      <h4 className="text-xs font-medium text-ct-muted mb-1">Exercise Log</h4>
                      <div className="flex flex-wrap gap-2 mb-2">
                        <Input type="date" value={exerciseDate} onChange={(e) => setExerciseDate(e.target.value)} className="w-36" />
                        <Select value={exerciseType} onValueChange={setExerciseType}>
                          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="tabletop">Tabletop</SelectItem><SelectItem value="walkthrough">Walkthrough</SelectItem><SelectItem value="full_simulation">Full Simulation</SelectItem></SelectContent>
                        </Select>
                        <Select value={exerciseOutcome} onValueChange={setExerciseOutcome}>
                          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="passed">Passed</SelectItem><SelectItem value="partial">Partial</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent>
                        </Select>
                        <Input placeholder="Findings (optional)" value={exerciseFindings} onChange={(e) => setExerciseFindings(e.target.value)} className="flex-1 min-w-[140px]" />
                        <Button size="sm" onClick={logExercise}><Plus className="w-3 h-3" /></Button>
                      </div>
                      <ul className="space-y-1 text-xs">
                        {detail.exercises.length === 0 ? <li className="text-ct-muted">None recorded.</li> : detail.exercises.map((ex) => (
                          <li key={ex.id}>{ex.exerciseDate} — {ex.exerciseType.replaceAll("_", " ")} <Badge variant="outline" className="ml-1">{ex.outcome}</Badge>{ex.findings ? ` — ${ex.findings}` : ""}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
