"use client";

export const dynamic = "force-dynamic";

// Wave 3 (2026-07-21): first-ever detail page for a single lead -- the hub
// page only ever showed leads inline in a list, no way to see full record,
// stage history, or activities (Wave 1's new crm_activities table) in one
// place. Mirrors crm/accounts/[id]/page.tsx's section layout.
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft, Loader2, Sparkles, Plus, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AiDecisionExplanationCard } from "@/components/ai/AiDecisionExplanationCard";
import type { AiDecisionExplanation } from "@/lib/explainability/ai-decision-explanation";

type Lead = {
  id: string; name: string; contactEmail: string | null; contactPhone: string | null; source: string | null; status: string;
  nextActionDate: string | null; nextActionNote: string | null;
  aiScore: number | null; aiScoreReasoning: string | null; aiRecommendedAction: string | null;
  createdAt: string;
};
type StageHistoryEntry = { id: string; fromStage: string | null; toStage: string; note: string | null; changedAt: string };
type Activity = { id: string; activityType: string; subject: string; dueDate: string | null; status: string; priority: string; notes: string | null; createdAt: string };

const LEAD_STATUS_COLORS: Record<string, string> = {
  new: "bg-ct-cloud text-ct-muted", contacted: "bg-ct-saffron/20 text-ct-saffron", qualified: "bg-ct-teal/20 text-ct-teal",
  converted: "bg-green-100 text-green-700", lost: "bg-red-100 text-red-700",
};

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const leadId = params.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [history, setHistory] = useState<StageHistoryEntry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
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
    const [leadRes, historyRes, activitiesRes] = await Promise.all([
      fetch(`/api/crm/leads/${leadId}`),
      fetch(`/api/crm/leads/${leadId}/stage-history`).catch(() => null),
      fetch(`/api/crm/activities?entityType=lead&entityId=${leadId}`),
    ]);
    if (leadRes.ok) setLead(await leadRes.json());
    if (historyRes && historyRes.ok) setHistory((await historyRes.json()).items ?? []);
    if (activitiesRes.ok) setActivities(await activitiesRes.json());
    setLoading(false);
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const scoreLead = async () => {
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/score`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Lead scored");
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to score lead"); }
  };

  const toggleExplain = async () => {
    if (showExplain) { setShowExplain(false); return; }
    setShowExplain(true);
    if (explanation) return;
    setExplaining(true);
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/explain`);
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
        body: JSON.stringify({ entityType: "lead", entityId: leadId, activityType, subject: activitySubject, dueDate: activityDueDate || undefined }),
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
  if (!lead) return (
    <div className="space-y-4">
      <Link href="/crm/leads" className="text-sm text-ct-muted hover:text-ct-navy flex items-center gap-1"><ArrowLeft className="size-4" /> Back to Leads</Link>
      <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">Lead not found.</CardContent></Card>
    </div>
  );

  return (
    <div className="space-y-4">
      <Link href="/crm/leads" className="text-sm text-ct-muted hover:text-ct-navy flex items-center gap-1 w-fit"><ArrowLeft className="size-4" /> Back to Leads</Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">{lead.name}</h1>
          <p className="text-sm text-ct-muted mt-1">{lead.contactEmail || "No contact"} {lead.contactPhone ? `· ${lead.contactPhone}` : ""} {lead.source ? `· ${lead.source}` : ""}</p>
        </div>
        <Badge className={`text-xs border-0 ${LEAD_STATUS_COLORS[lead.status] ?? "bg-ct-cloud text-ct-muted"}`}>{lead.status}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-xl shadow-card bg-white md:col-span-2">
          <CardHeader><CardTitle className="text-sm font-semibold text-ct-navy flex items-center gap-2"><Sparkles className="size-4 text-ct-saffron" /> AI Score</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {lead.aiScore != null ? (
              <>
                <p className="text-2xl font-heading text-ct-navy">{lead.aiScore}<span className="text-sm text-ct-muted">/100</span></p>
                {lead.aiScoreReasoning && <p className="text-sm text-ct-muted">{lead.aiScoreReasoning}</p>}
                {lead.aiRecommendedAction && <p className="text-sm text-ct-navy">Suggested: {lead.aiRecommendedAction}</p>}
              </>
            ) : <p className="text-sm text-ct-muted">Not scored yet.</p>}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={scoreLead}>{lead.aiScore != null ? "Re-score" : "Score this lead"}</Button>
              {lead.aiScore != null && (
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
                    <p className="text-ct-navy">{h.fromStage ? `${h.fromStage} → ` : ""}{h.toStage}</p>
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
              <DialogHeader><DialogTitle>New Activity</DialogTitle><DialogDescription>A task, meeting, or call tied to this lead.</DialogDescription></DialogHeader>
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
                  <Input value={activitySubject} onChange={(e) => setActivitySubject(e.target.value)} placeholder="Follow-up call about proposal" />
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
                  {a.status !== "completed" && (
                    <Button size="sm" variant="ghost" onClick={() => completeActivity(a.id)}><CheckCircle2 className="size-3.5" /></Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
