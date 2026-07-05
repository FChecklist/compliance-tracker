"use client";

export const dynamic = "force-dynamic";

// Wave 92 (Comparison CSV 3 gap analysis: GRC012 "Fraud Management").
// Zero fraud-detection/case-tracking capability existed anywhere in the
// codebase before this wave. A real case register with a status machine --
// not a detection-algorithm claim; VERIDIAN has no transaction-monitoring
// feed to run anomaly detection against, so this tracks cases however
// they're first identified.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Siren, Plus, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type FraudCase = {
  id: string; caseNumber: number; title: string; fraudType: string; detectionSource: string;
  status: string; financialExposure: string | null; reportedDate: string; resolutionSummary: string | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  reported: "outline", investigating: "secondary", confirmed: "default", unsubstantiated: "outline", resolved: "outline",
};
const NEXT_STATUS: Record<string, string[]> = {
  reported: ["investigating"], investigating: ["confirmed", "unsubstantiated"], confirmed: ["resolved"], unsubstantiated: ["resolved"], resolved: [],
};

function fmt(n: string | number) { return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function FraudCasesPage() {
  const [cases, setCases] = useState<FraudCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FraudCase | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [fraudType, setFraudType] = useState("other");
  const [detectionSource, setDetectionSource] = useState("other");
  const [description, setDescription] = useState("");
  const [financialExposure, setFinancialExposure] = useState("");
  const [reportedDate, setReportedDate] = useState(new Date().toISOString().slice(0, 10));
  const [creating, setCreating] = useState(false);
  const [resolutionSummary, setResolutionSummary] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/fraud-cases");
    setCases((await res.json()).cases ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadDetail(id: string) {
    setSelectedId(id);
    const res = await fetch(`/api/fraud-cases/${id}`);
    setDetail(res.ok ? await res.json() : null);
  }

  async function createCase() {
    if (!title.trim() || !reportedDate) { toast.error("Title and reported date are required"); return; }
    setCreating(true);
    const res = await fetch("/api/fraud-cases", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, fraudType, detectionSource, description: description || undefined, financialExposure: financialExposure ? Number(financialExposure) : undefined, reportedDate }),
    });
    setCreating(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to create fraud case"); return; }
    toast.success("Fraud case reported");
    setDialogOpen(false);
    setTitle(""); setDescription(""); setFinancialExposure("");
    load();
  }

  async function advance(status: string) {
    if (!selectedId) return;
    const res = await fetch(`/api/fraud-cases/${selectedId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, resolutionSummary: status === "resolved" ? resolutionSummary : undefined }),
    });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to update status"); return; }
    toast.success(`Case marked ${status}`);
    setResolutionSummary("");
    loadDetail(selectedId);
    load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2"><Siren className="w-6 h-6" />Fraud Case Management</h1>
        <p className="text-sm text-ct-muted mt-1">Case register for suspected fraud — detection source, financial exposure, investigation status, resolution.</p>
      </div>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <>
          <div className="flex justify-end mb-2">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal/90"><Plus className="w-4 h-4 mr-1" />Report Case</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Report Fraud Case</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Duplicate vendor payment" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Fraud Type</Label>
                      <Select value={fraudType} onValueChange={setFraudType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="financial">Financial</SelectItem><SelectItem value="procurement">Procurement</SelectItem>
                          <SelectItem value="payroll">Payroll</SelectItem><SelectItem value="expense">Expense</SelectItem>
                          <SelectItem value="inventory">Inventory</SelectItem><SelectItem value="cyber">Cyber</SelectItem><SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Detection Source</Label>
                      <Select value={detectionSource} onValueChange={setDetectionSource}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="internal_audit">Internal Audit</SelectItem><SelectItem value="whistleblower">Whistleblower</SelectItem>
                          <SelectItem value="system_alert">System Alert</SelectItem><SelectItem value="external_report">External Report</SelectItem>
                          <SelectItem value="management_review">Management Review</SelectItem><SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div><Label>Description</Label><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Financial Exposure</Label><Input type="number" value={financialExposure} onChange={(e) => setFinancialExposure(e.target.value)} placeholder="0.00" /></div>
                    <div><Label>Reported Date</Label><Input type="date" value={reportedDate} onChange={(e) => setReportedDate(e.target.value)} /></div>
                  </div>
                </div>
                <DialogFooter><Button onClick={createCase} disabled={creating}>{creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Report Case"}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">#</th><th className="p-3 font-medium">Title</th><th className="p-3 font-medium">Type</th><th className="p-3 font-medium">Status</th></tr></thead>
                  <tbody className="divide-y divide-ct-border">
                    {cases.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">No fraud cases reported.</td></tr>
                      : cases.map((c) => (
                        <tr key={c.id} className={`hover:bg-ct-row-hover cursor-pointer ${selectedId === c.id ? "bg-ct-row-hover" : ""}`} onClick={() => loadDetail(c.id)}>
                          <td className="p-3">{c.caseNumber}</td>
                          <td className="p-3">{c.title}</td>
                          <td className="p-3">{c.fraudType}</td>
                          <td className="p-3"><Badge variant={STATUS_VARIANT[c.status] ?? "outline"}>{c.status}</Badge></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4">
                {!selectedId || !detail ? (
                  <p className="text-sm text-ct-muted">Select a case to view details.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-ct-navy">{detail.title}</h3>
                      <Badge variant={STATUS_VARIANT[detail.status] ?? "outline"}>{detail.status}</Badge>
                    </div>
                    <p className="text-xs text-ct-muted">Type: {detail.fraudType} · Source: {detail.detectionSource} · Reported {detail.reportedDate}</p>
                    {detail.financialExposure && <p className="text-xs text-ct-muted">Financial exposure: {fmt(detail.financialExposure)}</p>}
                    {detail.resolutionSummary && <p className="text-xs text-ct-muted">Resolution: {detail.resolutionSummary}</p>}

                    {NEXT_STATUS[detail.status]?.length > 0 && (
                      <div className="space-y-2">
                        {detail.status === "confirmed" || detail.status === "unsubstantiated" ? (
                          <Textarea rows={2} placeholder="Resolution summary" value={resolutionSummary} onChange={(e) => setResolutionSummary(e.target.value)} />
                        ) : null}
                        <div className="flex gap-2">
                          {NEXT_STATUS[detail.status].map((s) => (
                            <Button key={s} size="sm" variant="outline" onClick={() => advance(s)}>{s.replaceAll("_", " ")}</Button>
                          ))}
                        </div>
                      </div>
                    )}
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
