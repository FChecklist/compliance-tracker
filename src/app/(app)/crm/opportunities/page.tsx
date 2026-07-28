"use client";

export const dynamic = "force-dynamic";

// Wave 3 (2026-07-21): dedicated Opportunities page. Kanban is the primary
// view -- the Odoo/Zoho/Infisuite reverse-engineering pass (this same
// session) found Odoo's stage-column Kanban with a clickable stage
// breadcrumb the strongest of the 3 reference systems' UX for this exact
// screen; this reproduces that pattern (columns = stage, drag not
// implemented this wave, but each card carries a stage <Select> matching
// the breadcrumb's "click to move stage" intent). List view (the hub's
// prior only view) stays available as a toggle, now paginated (Wave 3's
// opportunities/route.ts fix) where the old hub page was not. Marking an
// opportunity Lost now offers the structured Lost Reason picker (Wave 1) --
// the Odoo reference's own headline finding was that this must be
// structured, not free text.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Loader2, Target, Sparkles, ListChecks, LayoutGrid, List as ListIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Opportunity = {
  id: string; name: string; leadId: string | null; clientId: string | null; stage: string;
  estimatedValue: string | null; expectedCloseDate: string | null; lostReasonId: string | null;
  aiWinProbability: number | null; aiRiskFactors: string[]; aiRecommendedAction: string | null;
};
type Lead = { id: string; name: string };
type LostReason = { id: string; reasonText: string };

const STAGES = ["prospecting", "proposal", "negotiation", "won", "lost"] as const;
const STAGE_LABELS: Record<string, string> = { prospecting: "Prospecting", proposal: "Proposal", negotiation: "Negotiation", won: "Won", lost: "Lost" };
const STAGE_COLORS: Record<string, string> = {
  prospecting: "bg-ct-cloud text-ct-muted", proposal: "bg-ct-saffron/20 text-ct-saffron", negotiation: "bg-ct-teal/20 text-ct-teal",
  won: "bg-green-100 text-green-700", lost: "bg-red-100 text-red-700",
};

export default function CrmOpportunitiesPage() {
  const currencies = useCurrencies();
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [leads, setLeads] = useState<Lead[]>([]);
  const [lostReasons, setLostReasons] = useState<LostReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [creatingTaskId, setCreatingTaskId] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [leadId, setLeadId] = useState("");
  const [value, setValue] = useState("");
  const [creating, setCreating] = useState(false);

  const [lostDialogFor, setLostDialogFor] = useState<string | null>(null);
  const [lostReasonId, setLostReasonId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    // Kanban shows the full working pipeline in one board -- a large
    // pageSize here, not the list view's 25/page, matching Odoo's own
    // Kanban (no pagination on the board itself, only on List view).
    const kanbanParams = new URLSearchParams({ page: "1", pageSize: "500" });
    const listParams = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    const [oppRes, leadRes, reasonRes] = await Promise.all([
      fetch(`/api/crm/opportunities?${(view === "kanban" ? kanbanParams : listParams).toString()}`),
      fetch("/api/crm/leads?pageSize=200"),
      fetch("/api/crm/lost-reasons"),
    ]);
    const oppData = await oppRes.json();
    setOpportunities(oppData.items ?? []);
    setTotal(oppData.total ?? 0);
    const leadData = await leadRes.json();
    setLeads(leadData.items ?? []);
    if (reasonRes.ok) setLostReasons(await reasonRes.json());
    setLoading(false);
  }, [page, view]);

  useEffect(() => { load(); }, [load]);

  const createOpportunity = async () => {
    if (!name.trim() || !leadId) return;
    setCreating(true);
    try {
      const res = await fetch("/api/crm/opportunities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, leadId, estimatedValue: value ? Number(value) : undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Opportunity created");
      setOpen(false);
      setName(""); setLeadId(""); setValue("");
      load();
    } catch { toast.error("Failed to create opportunity"); }
    finally { setCreating(false); }
  };

  const updateStage = async (opportunityId: string, stage: string, lostReasonIdForUpdate?: string) => {
    if (stage === "lost" && !lostReasonIdForUpdate) {
      setLostDialogFor(opportunityId);
      return;
    }
    try {
      const res = await fetch(`/api/crm/opportunities/${opportunityId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, ...(lostReasonIdForUpdate ? { lostReasonId: lostReasonIdForUpdate } : {}) }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch { toast.error("Failed to update opportunity"); }
  };

  const confirmLost = async () => {
    if (!lostDialogFor || !lostReasonId) return;
    await updateStage(lostDialogFor, "lost", lostReasonId);
    setLostDialogFor(null);
    setLostReasonId("");
  };

  const analyzeOpportunity = async (opportunityId: string) => {
    setScoringId(opportunityId);
    try {
      const res = await fetch(`/api/crm/opportunities/${opportunityId}/analyze`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Opportunity analyzed");
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to analyze opportunity"); }
    finally { setScoringId(null); }
  };

  const createFollowUpTask = async (opportunityId: string) => {
    setCreatingTaskId(opportunityId);
    try {
      const res = await fetch(`/api/crm/opportunities/${opportunityId}/follow-up-task`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Follow-up task created and dispatched to VERI To Do");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to create follow-up task"); }
    finally { setCreatingTaskId(null); }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const fmt = (v: string | null) => v ? `${currencyLabel(undefined, currencies)}${Number(v).toLocaleString()}` : null;

  const OppCard = ({ opp }: { opp: Opportunity }) => (
    <Card className="rounded-lg shadow-card bg-white">
      <CardContent className="p-3 space-y-2">
        <Link href={`/crm/opportunities/${opp.id}`} className="block">
          <p className="text-sm font-medium text-ct-navy hover:underline">{opp.name}</p>
        </Link>
        <p className="text-xs text-ct-muted">
          {fmt(opp.estimatedValue) ?? "No value set"}
          {opp.expectedCloseDate ? ` · closes ${new Date(opp.expectedCloseDate).toLocaleDateString()}` : ""}
        </p>
        {opp.aiWinProbability != null && (
          <Badge variant="outline" className="text-xs gap-1"><Sparkles className="size-3 text-ct-saffron" /> {opp.aiWinProbability}% win</Badge>
        )}
        <Select value={opp.stage} onValueChange={(v) => updateStage(opp.id, v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}</SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => analyzeOpportunity(opp.id)} disabled={scoringId === opp.id}>
            {scoringId === opp.id ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          </Button>
          {opp.aiRecommendedAction && (
            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => createFollowUpTask(opp.id)} disabled={creatingTaskId === opp.id}>
              {creatingTaskId === opp.id ? <Loader2 className="size-3 animate-spin" /> : <ListChecks className="size-3" />}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Opportunities</h1>
          <p className="text-sm text-ct-muted mt-1">Deals in progress -- linked to a lead, tracked stage by stage.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-ct-border bg-white p-0.5">
            <Button size="sm" variant={view === "kanban" ? "default" : "ghost"} className={`h-7 px-2 ${view === "kanban" ? "bg-ct-navy text-white" : ""}`} onClick={() => setView("kanban")}><LayoutGrid className="size-3.5" /></Button>
            <Button size="sm" variant={view === "list" ? "default" : "ghost"} className={`h-7 px-2 ${view === "list" ? "bg-ct-navy text-white" : ""}`} onClick={() => setView("list")}><ListIcon className="size-3.5" /></Button>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={leads.length === 0}><Target className="w-4 h-4 mr-1" />New Opportunity</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Opportunity</DialogTitle><DialogDescription>Linked to a lead.</DialogDescription></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="GST advisory engagement" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Lead</Label>
                  <Select value={leadId} onValueChange={setLeadId}>
                    <SelectTrigger><SelectValue placeholder="Choose a lead" /></SelectTrigger>
                    <SelectContent>{leads.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Estimated Value (optional)</Label>
                  <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="150000" />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={createOpportunity} disabled={creating || !name.trim() || !leadId} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                  {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                  Create Opportunity
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Dialog open={!!lostDialogFor} onOpenChange={(o) => !o && setLostDialogFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Why was this lost?</DialogTitle><DialogDescription>A structured reason keeps loss analysis meaningful across the whole pipeline.</DialogDescription></DialogHeader>
          <div className="py-2">
            <Select value={lostReasonId} onValueChange={setLostReasonId}>
              <SelectTrigger><SelectValue placeholder="Choose a reason" /></SelectTrigger>
              <SelectContent>{lostReasons.map((r) => <SelectItem key={r.id} value={r.id}>{r.reasonText}</SelectItem>)}</SelectContent>
            </Select>
            {lostReasons.length === 0 && <p className="text-xs text-ct-muted mt-2">No lost reasons configured yet -- add one in Settings.</p>}
          </div>
          <DialogFooter><Button onClick={confirmLost} disabled={!lostReasonId} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">Mark Lost</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {loading ? <p className="text-sm text-ct-muted">Loading...</p> : opportunities.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No opportunities yet.</CardContent></Card>
      ) : view === "kanban" ? (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {STAGES.map((stage) => {
            const stageOpps = opportunities.filter((o) => o.stage === stage);
            const stageTotal = stageOpps.reduce((sum, o) => sum + (o.estimatedValue ? Number(o.estimatedValue) : 0), 0);
            return (
              <div key={stage} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <Badge className={`text-xs border-0 ${STAGE_COLORS[stage]}`}>{STAGE_LABELS[stage]}</Badge>
                  <span className="text-xs text-ct-muted">{stageOpps.length}</span>
                </div>
                <p className="text-xs text-ct-muted px-1">{fmt(String(stageTotal)) ?? "—"}</p>
                <div className="space-y-2 min-h-[100px]">
                  {stageOpps.map((opp) => <OppCard key={opp.id} opp={opp} />)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
            {opportunities.map((opp) => (
              <div key={opp.id} className="px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-3">
                  <Link href={`/crm/opportunities/${opp.id}`} className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ct-navy hover:underline">{opp.name}</p>
                    <p className="text-xs text-ct-muted">{fmt(opp.estimatedValue) ?? "No value set"}{opp.expectedCloseDate ? ` · closes ${new Date(opp.expectedCloseDate).toLocaleDateString()}` : ""}</p>
                  </Link>
                  {opp.aiWinProbability != null && <Badge variant="outline" className="text-xs gap-1"><Sparkles className="size-3 text-ct-saffron" /> {opp.aiWinProbability}%</Badge>}
                  <Badge className={`text-xs border-0 ${STAGE_COLORS[opp.stage] ?? "bg-ct-cloud text-ct-muted"}`}>{STAGE_LABELS[opp.stage] ?? opp.stage}</Badge>
                  <Select value={opp.stage} onValueChange={(v) => updateStage(opp.id, v)}>
                    <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="sm" variant="ghost" onClick={() => analyzeOpportunity(opp.id)} disabled={scoringId === opp.id}>
                    {scoringId === opp.id ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-xs text-ct-muted">
            <span>{total} opportunit{total === 1 ? "y" : "ies"} total</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 px-2" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="size-3.5" /></Button>
              <span>Page {page} of {totalPages}</span>
              <Button size="sm" variant="outline" className="h-7 px-2" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="size-3.5" /></Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
