"use client";

export const dynamic = "force-dynamic";

// Wave 82 (Period Closing checklist workflow, COMPARISON_CSV_GAP_ANALYSIS.md
// backlog #3). Fiscal years + period generation + close/reopen already had
// API routes since Wave 50 with zero UI consumer -- this is the first UI
// for any of it, built around the new checklist/sign-off gate.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, CheckCircle2, Circle, ShieldCheck, Lock, LockOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type FiscalYear = { id: string; yearName: string };
type Period = { id: string; periodName: string; status: string; signedOffAt: string | null };
type ChecklistItem = { id: string; title: string; taskType: string; status: string };

const STATUS_COLORS: Record<string, string> = {
  open: "bg-ct-teal/20 text-ct-teal",
  closed: "bg-ct-cloud text-ct-muted",
};

export default function ErpPeriodsPage() {
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [selectedFy, setSelectedFy] = useState("");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [expandedPeriodId, setExpandedPeriodId] = useState<string | null>(null);
  const [checklists, setChecklists] = useState<Record<string, ChecklistItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadFiscalYears = useCallback(async () => {
    const res = await fetch("/api/erp/fiscal-years");
    const data = await res.json();
    setFiscalYears(data.fiscalYears ?? []);
    if (data.fiscalYears?.length && !selectedFy) setSelectedFy(data.fiscalYears[0].id);
    setLoading(false);
  }, [selectedFy]);

  const loadPeriods = useCallback(async (fyId: string) => {
    if (!fyId) return;
    const res = await fetch(`/api/erp/periods?fiscalYearId=${fyId}`);
    const data = await res.json();
    setPeriods(data.periods ?? []);
  }, []);

  useEffect(() => { loadFiscalYears(); }, [loadFiscalYears]);
  useEffect(() => { if (selectedFy) loadPeriods(selectedFy); }, [selectedFy, loadPeriods]);

  const generatePeriods = async () => {
    if (!selectedFy) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/erp/periods/generate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fiscalYearId: selectedFy }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Periods generated");
      loadPeriods(selectedFy);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate periods");
    } finally {
      setGenerating(false);
    }
  };

  const toggleChecklist = async (periodId: string) => {
    if (expandedPeriodId === periodId) { setExpandedPeriodId(null); return; }
    setExpandedPeriodId(periodId);
    if (!checklists[periodId]) {
      const res = await fetch(`/api/erp/periods/${periodId}/checklist`);
      const data = await res.json();
      setChecklists((prev) => ({ ...prev, [periodId]: data.items ?? [] }));
    }
  };

  const completeItem = async (periodId: string, itemId: string) => {
    setBusyId(itemId);
    const res = await fetch(`/api/erp/periods/checklist/${itemId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setBusyId(null);
    if (!res.ok) { toast.error("Failed to complete item"); return; }
    const item = await res.json();
    setChecklists((prev) => ({ ...prev, [periodId]: prev[periodId].map((i) => (i.id === itemId ? item : i)) }));
  };

  const addItem = async (periodId: string) => {
    if (!newItemTitle.trim()) return;
    const res = await fetch(`/api/erp/periods/${periodId}/checklist`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newItemTitle.trim() }),
    });
    if (!res.ok) { toast.error("Failed to add item"); return; }
    const item = await res.json();
    setChecklists((prev) => ({ ...prev, [periodId]: [...(prev[periodId] ?? []), item] }));
    setNewItemTitle("");
  };

  const signOff = async (periodId: string) => {
    setBusyId(periodId);
    try {
      const res = await fetch(`/api/erp/periods/${periodId}/sign-off`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Period signed off");
      loadPeriods(selectedFy);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sign off");
    } finally {
      setBusyId(null);
    }
  };

  const closePeriodAction = async (periodId: string) => {
    setBusyId(periodId);
    try {
      const res = await fetch(`/api/erp/periods/${periodId}/close`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Period closed");
      loadPeriods(selectedFy);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to close period");
    } finally {
      setBusyId(null);
    }
  };

  const reopenPeriodAction = async (periodId: string) => {
    setBusyId(periodId);
    const res = await fetch(`/api/erp/periods/${periodId}/reopen`, { method: "POST" });
    setBusyId(null);
    if (!res.ok) { toast.error("Failed to reopen period"); return; }
    toast.success("Period reopened");
    loadPeriods(selectedFy);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Period Closing</h1>
        <p className="text-sm text-ct-muted mt-1">A formal month-end close: complete the checklist, sign off, then close -- VERI ERP AI.</p>
      </div>

      <div className="flex items-center gap-2">
        <Select value={selectedFy} onValueChange={setSelectedFy}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Select fiscal year" /></SelectTrigger>
          <SelectContent>{fiscalYears.map((fy) => <SelectItem key={fy.id} value={fy.id}>{fy.yearName}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" onClick={generatePeriods} disabled={!selectedFy || generating}>
          {generating ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Plus className="size-4 mr-1.5" />} Generate Periods
        </Button>
      </div>

      {loading ? <p className="text-sm text-ct-muted">Loading...</p> : periods.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No periods yet for this fiscal year -- generate them above.</CardContent></Card>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
          {periods.map((p) => {
            const items = checklists[p.id] ?? [];
            const allComplete = items.length > 0 && items.every((i) => i.status === "completed");
            return (
              <div key={p.id} className="px-4 py-3 space-y-2">
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleChecklist(p.id)} className="flex-1 text-left text-sm font-medium text-ct-navy hover:underline">{p.periodName}</button>
                  <Badge className={`text-xs border-0 ${STATUS_COLORS[p.status] ?? ""}`}>{p.status}</Badge>
                  {p.signedOffAt && <Badge variant="outline" className="text-xs gap-1"><ShieldCheck className="size-3" /> Signed off</Badge>}
                  {p.status === "open" ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => signOff(p.id)} disabled={busyId === p.id || !!p.signedOffAt}>Sign Off</Button>
                      <Button size="sm" className="bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={() => closePeriodAction(p.id)} disabled={busyId === p.id}>
                        {busyId === p.id ? <Loader2 className="size-3.5 animate-spin" /> : <Lock className="size-3.5 mr-1" />} Close
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => reopenPeriodAction(p.id)} disabled={busyId === p.id}>
                      <LockOpen className="size-3.5 mr-1" /> Reopen
                    </Button>
                  )}
                </div>

                {expandedPeriodId === p.id && (
                  <div className="pl-2 space-y-1.5 border-l-2 border-ct-border ml-1">
                    {items.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 text-sm">
                        <button onClick={() => item.status !== "completed" && completeItem(p.id, item.id)} disabled={busyId === item.id}>
                          {item.status === "completed" ? <CheckCircle2 className="size-4 text-ct-teal" /> : <Circle className="size-4 text-ct-muted" />}
                        </button>
                        <span className={item.status === "completed" ? "text-ct-muted line-through" : "text-ct-navy"}>{item.title}</span>
                        <Badge variant="outline" className="text-[10px]">{item.taskType}</Badge>
                      </div>
                    ))}
                    {allComplete && <p className="text-xs text-ct-teal">All checklist items complete -- ready to sign off.</p>}
                    <div className="flex items-center gap-2 pt-1">
                      <Input value={newItemTitle} onChange={(e) => setNewItemTitle(e.target.value)} placeholder="Add a checklist item..." className="h-8 text-xs" />
                      <Button size="sm" variant="outline" className="h-8" onClick={() => addItem(p.id)} disabled={!newItemTitle.trim()}>Add</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
