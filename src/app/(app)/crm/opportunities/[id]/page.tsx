"use client";

export const dynamic = "force-dynamic";

// Wave 3 (2026-07-21): first-ever detail page for a single opportunity,
// same rationale as leads/[id]/page.tsx.
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft, Loader2, Sparkles, Plus, CheckCircle2 } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AiDecisionExplanationCard } from "@/components/ai/AiDecisionExplanationCard";
import type { AiDecisionExplanation } from "@/lib/explainability/ai-decision-explanation";

type Opportunity = {
  id: string; name: string; stage: string; estimatedValue: string | null; expectedCloseDate: string | null;
  aiWinProbability: number | null; aiRiskFactors: string[]; aiRecommendedAction: string | null;
};
type StageHistoryEntry = { id: string; fromStage: string | null; toStage: string; note: string | null; changedAt: string };
type Activity = { id: string; activityType: string; subject: string; dueDate: string | null; status: string };

const STAGE_LABELS: Record<string, string> = { prospecting: "Prospecting", proposal: "Proposal", negotiation: "Negotiation", won: "Won", lost: "Lost" };
const STAGE_COLORS: Record<string, string> = {
  prospecting: "bg-ct-cloud text-ct-muted", proposal: "bg-ct-saffron/20 text-ct-saffron", negotiation: "bg-ct-teal/20 text-ct-teal",
  won: "bg-green-100 text-green-700", lost: "bg-red-100 text-red-700",
};

export default function OpportunityDetailPage() {
  const params = useParams();
  const currencies = useCurrencies();
  const opportunityId = params.id as string;

  const [opp, setOpp] = useState<Opportunity | null>(null);
  const [history, setHistory] = useState<StageHistoryEntry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<AiDecisionExplanation | null>(null);
  const [showExplain, setShowExplain] = useState(false);

  const [activityOpen, setActivityOpen] = useState(false);
  const [activityType, setActivityType] = useState<"task" | "meeting" | "call">("task");
  const [activitySubject, setActivitySubject] = useState("");
  const [activityDueDate, setActivityDueDate] = useState("");
  const [creatingActivity, setCreatingActivity] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [oppRes, historyRes, activitiesRes] = await Promise.all([
      fetch(`/api/crm/opportunities/${opportunityId}`),
      fetch(`/api/crm/opportunities/${opportunityId}/stage-history`),
      fetch(`/api/crm/activities?entityType=opportunity&entityId=${opportunityId}`),
    ]);
    if (oppRes.ok) setOpp(await oppRes.json());
    if (historyRes.ok) setHistory((await historyRes.json()).items ?? []);
    if (activitiesRes.ok) setActivities(await activitiesRes.json());
    setLoading(false);
  }, [opportunityId]);

  useEffect(() => { load(); }, [load]);

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/crm/opportunities/${opportunityId}/analyze`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Opportunity analyzed");
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to analyze opportunity"); }
    finally { setAnalyzing(false); }
  };

  const toggleExplain = async () => {
    if (showExplain) { setShowExplain(false); return; }
    setShowExplain(true);
    if (explanation) return;
    setExplaining(true);
    try {
      const res = await fetch(`/api/crm/opportunities/${opportunityId}/explain`);
      const data = await res.json();
      setExplanation(res.ok ? (data.explanation ?? null) : null);
    } finally { setExplaining(false); }
  };

  const createActivity = async () => {
    if (!activitySubject.trim()) return;
    setCreatingActivity(true);
    try {
      const res = await fetch("/api/crm/activities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: "opportunity", entityId: opportunityId, activityType, subject: activitySubject, dueDate: activityDueDate || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Activity added");
      setActivityOpen(false);
      setActivitySubject(""); setActivityDueDate("");
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to create activity"); }
    finally { setCreatingActivity(false); }
  };

  const completeActivity = async (activityId: string) => {
    try {
      const res = await fetch(`/api/crm/activities/${activityId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch { toast.error("Failed to complete activity"); }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!opp) return (
    <div className="space-y-4">
      <Link href="/crm/opportunities" className="text-sm text-ct-muted hover:text-ct-navy flex items-center gap-1"><ArrowLeft className="size-4" /> Back to Opportunities</Link>
      <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">Opportunity not found.</CardContent></Card>
    </div>
  );

  return (
    <div className="space-y-4">
      <Link href="/crm/opportunities" className="text-sm text-ct-muted hover:text-ct-navy flex items-center gap-1 w-fit"><ArrowLeft className="size-4" /> Back to Opportunities</Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">{opp.name}</h1>
          <p className="text-sm text-ct-muted mt-1">
            {opp.estimatedValue ? `${currencyLabel(undefined, currencies)}${Number(opp.estimatedValue).toLocaleString()}` : "No value set"}
            {opp.expectedCloseDate ? ` · closes ${new Date(opp.expectedCloseDate).toLocaleDateString()}` : ""}
          </p>
        </div>
        <Badge className={`text-xs border-0 ${STAGE_COLORS[opp.stage] ?? "bg-ct-cloud text-ct-muted"}`}>{STAGE_LABELS[opp.stage] ?? opp.stage}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-xl shadow-card bg-white md:col-span-2">
          <CardHeader><CardTitle className="text-sm font-semibold text-ct-navy flex items-center gap-2"><Sparkles className="size-4 text-ct-saffron" /> AI Analysis</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {opp.aiWinProbability != null ? (
              <>
                <p className="text-2xl font-heading text-ct-navy">{opp.aiWinProbability}%<span className="text-sm text-ct-muted"> win probability</span></p>
                {opp.aiRiskFactors?.length > 0 && <p className="text-sm text-ct-muted">Risks: {opp.aiRiskFactors.join(", ")}</p>}
                {opp.aiRecommendedAction && <p className="text-sm text-ct-navy">Suggested: {opp.aiRecommendedAction}</p>}
              </>
            ) : <p className="text-sm text-ct-muted">Not analyzed yet.</p>}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={analyze} disabled={analyzing}>
                {analyzing ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
                {opp.aiWinProbability != null ? "Re-analyze" : "Analyze this opportunity"}
              </Button>
              {opp.aiWinProbability != null && (
                <Button size="sm" variant="ghost" onClick={toggleExplain}>
                  {explaining ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
                  {showExplain ? "Hide why" : "Why?"}
                </Button>
              )}
            </div>
            {showExplain && explanation && <AiDecisionExplanationCard explanation={explanation} />}
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-sm font-semibold text-ct-navy">Stage History</CardTitle></CardHeader>
          <CardContent>
            {history.length === 0 ? <p className="text-xs text-ct-muted">No history yet.</p> : (
              <div className="space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="text-xs">
                    <p className="text-ct-navy">{h.fromStage ? `${STAGE_LABELS[h.fromStage] ?? h.fromStage} → ` : ""}{STAGE_LABELS[h.toStage] ?? h.toStage}</p>
                    <p className="text-ct-muted">{new Date(h.changedAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-ct-navy">Activities</CardTitle>
          <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="size-3.5 mr-1" /> Add</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Activity</DialogTitle><DialogDescription>A task, meeting, or call tied to this opportunity.</DialogDescription></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Type</Label>
                  <Select value={activityType} onValueChange={(v) => setActivityType(v as typeof activityType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="task">Task</SelectItem>
                      <SelectItem value="meeting">Meeting</SelectItem>
                      <SelectItem value="call">Call</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Subject</Label>
                  <Input value={activitySubject} onChange={(e) => setActivitySubject(e.target.value)} placeholder="Send revised proposal" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Due Date (optional)</Label>
                  <Input type="date" value={activityDueDate} onChange={(e) => setActivityDueDate(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={createActivity} disabled={creatingActivity || !activitySubject.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                  {creatingActivity ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                  Add Activity
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? <p className="text-xs text-ct-muted">No activities yet.</p> : (
            <div className="divide-y divide-ct-border">
              {activities.map((a) => (
                <div key={a.id} className="py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ct-navy">{a.subject}</p>
                    <p className="text-xs text-ct-muted">{a.activityType} {a.dueDate ? `· due ${new Date(a.dueDate).toLocaleDateString()}` : ""}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">{a.status}</Badge>
                  {a.status !== "completed" && <Button size="sm" variant="ghost" onClick={() => completeActivity(a.id)}><CheckCircle2 className="size-3.5" /></Button>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
