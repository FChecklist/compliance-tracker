"use client";

export const dynamic = "force-dynamic";

// GST Verification & Reconciliation Engine (2026-07-08). Deterministic
// import -> validate -> reconcile -> file pipeline for CAs/accountants --
// see veridian_gst_engine_design memory + drizzle/0097_gst_reconciliation_engine.sql.
// AI only touches the review-report step at the very end.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, CheckCircle2, Sparkles, FileJson } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Batch = {
  id: string; fileName: string; sourceType: string; direction: string; period: string;
  status: string; totalRows: number | null; stagedCount: number | null; confirmedCount: number | null;
};
type Finding = { id: string; ruleCode: string; severity: string; message: string; suggestedFix: string | null };
type ReconRun = { id: string; period: string; status: string; exactMatches: number | null; probableMatches: number | null; mismatches: number | null; missingIn2b: number | null; missingInBooks: number | null };
type ReturnPeriod = { id: string; period: string; gstin: string; returnType: string; status: string; summary: Record<string, unknown> | null; generatedJson: unknown };
type AiReview = { verdict: string; summary: string; topIssues: { title: string; amountAtStake: number | null; recommendation: string }[]; reportText: string };

const SEVERITY_COLORS: Record<string, string> = { error: "bg-red-100 text-red-700", warning: "bg-amber-100 text-amber-700", info: "bg-blue-100 text-blue-700" };
const STATUS_COLORS: Record<string, string> = { processing: "bg-ct-cloud text-ct-muted", staged: "bg-amber-100 text-amber-700", confirmed: "bg-green-100 text-green-700", failed: "bg-red-100 text-red-700", cancelled: "bg-ct-cloud text-ct-muted" };
const MATCH_COLORS: Record<string, string> = { exact: "bg-green-100 text-green-700", probable: "bg-blue-100 text-blue-700", mismatch: "bg-amber-100 text-amber-700", missing_in_2b: "bg-red-100 text-red-700", missing_in_books: "bg-red-100 text-red-700" };

export default function GstReconciliationPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [findings, setFindings] = useState<Finding[]>([]);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState("excel_generic");
  const [direction, setDirection] = useState("sales");
  const [period, setPeriod] = useState("");
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [purchaseBatchId, setPurchaseBatchId] = useState("");
  const [gstr2bBatchId, setGstr2bBatchId] = useState("");
  const [reconRun, setReconRun] = useState<ReconRun | null>(null);
  const [reconciling, setReconciling] = useState(false);

  const [returnGstin, setReturnGstin] = useState("");
  const [returnPeriod, setReturnPeriod] = useState("");
  const [returnType, setReturnType] = useState("gstr1");
  const [generatedReturn, setGeneratedReturn] = useState<ReturnPeriod | null>(null);
  const [generating, setGenerating] = useState(false);
  const [aiReview, setAiReview] = useState<AiReview | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(() => {
    fetch("/api/gst-reconciliation/import").then(r => r.json()).then(d => { setBatches(d.batches ?? []); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const loadFindings = useCallback((batchId: string) => {
    if (!batchId) { setFindings([]); return; }
    fetch(`/api/gst-reconciliation/import/${batchId}/findings`).then(r => r.json()).then(d => setFindings(d.findings ?? [])).catch(() => setFindings([]));
  }, []);
  useEffect(() => { loadFindings(selectedBatchId); }, [selectedBatchId, loadFindings]);

  const upload = async () => {
    if (!uploadFile || !period) { toast.error("File and period are required"); return; }
    setUploading(true);
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("sourceType", sourceType);
    formData.append("direction", direction);
    formData.append("period", period);
    const res = await fetch("/api/gst-reconciliation/import", { method: "POST", body: formData });
    setUploading(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Import failed"); return; }
    const d = await res.json();
    setUploadOpen(false); setUploadFile(null);
    toast.success(`Staged ${d.stagedCount} rows`);
    load();
  };

  const confirmBatch = async (batchId: string) => {
    setConfirming(true);
    const res = await fetch(`/api/gst-reconciliation/import/${batchId}/confirm`, { method: "POST" });
    setConfirming(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Confirm failed"); return; }
    const d = await res.json();
    toast.success(`Confirmed ${d.confirmedCount} invoices, ${d.findingsCount} findings`);
    load();
    loadFindings(batchId);
  };

  const runReconcile = async () => {
    if (!purchaseBatchId || !gstr2bBatchId) { toast.error("Select both a purchase-register batch and a GSTR-2B batch"); return; }
    setReconciling(true);
    const purchaseBatch = batches.find(b => b.id === purchaseBatchId);
    const res = await fetch("/api/gst-reconciliation/reconcile", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period: purchaseBatch?.period, purchaseBatchId, gstr2bBatchId }),
    });
    setReconciling(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Reconciliation failed"); return; }
    const d = await res.json();
    const runRes = await fetch(`/api/gst-reconciliation/reconcile/${d.runId}`);
    const runData = await runRes.json();
    setReconRun(runData.run);
    toast.success("Reconciliation complete");
  };

  const generateReturn = async () => {
    if (!returnGstin || !returnPeriod) { toast.error("GSTIN and period are required"); return; }
    setGenerating(true);
    const res = await fetch("/api/gst-reconciliation/returns", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gstin: returnGstin, period: returnPeriod, returnType }),
    });
    setGenerating(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Return generation failed"); return; }
    const d = await res.json();
    setGeneratedReturn(d);
    setAiReview(null);
    toast.success(`${returnType.toUpperCase()} generated`);
  };

  const downloadReturnJson = () => {
    if (!generatedReturn) return;
    const blob = new Blob([JSON.stringify(generatedReturn.generatedJson, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${generatedReturn.returnType}_${generatedReturn.period}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const runAiReview = async () => {
    if (!generatedReturn) return;
    setReviewing(true);
    const res = await fetch(`/api/gst-reconciliation/returns/${generatedReturn.id}/ai-review`, { method: "POST" });
    setReviewing(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "AI review failed"); return; }
    const d = await res.json();
    setAiReview(d);
  };

  const selectedBatch = batches.find(b => b.id === selectedBatchId);
  const confirmedBatches = batches.filter(b => b.status === "confirmed");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">GST Reconciliation</h1>
          <p className="text-sm text-ct-muted mt-1">Import from Excel, CSV, Tally, Busy, or Zoho Books → validate → reconcile GSTR-2B → generate GSTR-1/3B — deterministic engine, AI only reviews the result</p>
        </div>
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Upload className="w-4 h-4 mr-1" />Import</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Import GST Data</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Source</Label>
                <Select value={sourceType} onValueChange={setSourceType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="excel_generic">Excel (generic)</SelectItem>
                    <SelectItem value="csv_generic">CSV (generic)</SelectItem>
                    <SelectItem value="tally_xml">Tally (XML export)</SelectItem>
                    <SelectItem value="busy">Busy (Excel/CSV export)</SelectItem>
                    <SelectItem value="zoho_books">Zoho Books (CSV export)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Direction</Label>
                <Select value={direction} onValueChange={setDirection}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sales">Sales register</SelectItem>
                    <SelectItem value="purchase">Purchase register</SelectItem>
                    <SelectItem value="gstr2b">GSTR-2B (from portal)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Period (YYYY-MM)</Label><Input placeholder="2026-06" value={period} onChange={e => setPeriod(e.target.value)} /></div>
              <div><Label>File</Label><input type="file" accept=".csv,.xlsx,.xls,.xml" onChange={e => setUploadFile(e.target.files?.[0] ?? null)} className="text-sm" /></div>
            </div>
            <DialogFooter><Button onClick={upload} disabled={uploading || !uploadFile || !period} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{uploading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Import</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="imports">
        <TabsList>
          <TabsTrigger value="imports">Imports</TabsTrigger>
          <TabsTrigger value="reconcile">Reconcile 2B</TabsTrigger>
          <TabsTrigger value="returns">Generate Return</TabsTrigger>
        </TabsList>

        <TabsContent value="imports" className="space-y-4">
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border">
                  <th className="p-3 font-medium">File</th><th className="p-3 font-medium">Source</th><th className="p-3 font-medium">Direction</th>
                  <th className="p-3 font-medium">Period</th><th className="p-3 font-medium">Rows</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th>
                </tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={7} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : batches.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-ct-muted">No imports yet — click Import to get started.</td></tr>
                    : batches.map(b => (
                      <tr key={b.id} className={`hover:bg-ct-row-hover cursor-pointer ${selectedBatchId === b.id ? "bg-ct-row-hover" : ""}`} onClick={() => setSelectedBatchId(b.id)}>
                        <td className="p-3">{b.fileName}</td><td className="p-3">{b.sourceType}</td><td className="p-3">{b.direction}</td>
                        <td className="p-3">{b.period}</td><td className="p-3">{b.status === "confirmed" ? b.confirmedCount : b.stagedCount ?? b.totalRows}</td>
                        <td className="p-3"><Badge className={STATUS_COLORS[b.status] ?? ""}>{b.status}</Badge></td>
                        <td className="p-3">{b.status === "staged" && <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={(e) => { e.stopPropagation(); confirmBatch(b.id); }} disabled={confirming}><CheckCircle2 className="w-3 h-3 mr-1" />Confirm</Button>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {selectedBatch && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4">
                <h3 className="font-heading text-lg text-ct-navy mb-2">Findings — {selectedBatch.fileName}</h3>
                {findings.length === 0 ? (
                  <p className="text-sm text-ct-muted">{selectedBatch.status === "confirmed" ? "No issues found." : "Confirm this batch to run validation."}</p>
                ) : (
                  <div className="space-y-2">
                    {findings.map(f => (
                      <div key={f.id} className="flex items-start gap-2 text-sm border-b border-ct-border pb-2">
                        <Badge className={SEVERITY_COLORS[f.severity] ?? ""}>{f.severity}</Badge>
                        <div><p className="text-ct-navy">{f.message}</p>{f.suggestedFix && <p className="text-ct-muted text-xs mt-0.5">Fix: {f.suggestedFix}</p>}</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="reconcile" className="space-y-4">
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-4 space-y-3">
              <div className="flex gap-4">
                <div className="flex-1"><Label>Purchase Register (confirmed batch)</Label>
                  <Select value={purchaseBatchId} onValueChange={setPurchaseBatchId}>
                    <SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger>
                    <SelectContent>{confirmedBatches.filter(b => b.direction === "purchase").map(b => <SelectItem key={b.id} value={b.id}>{b.fileName} ({b.period})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex-1"><Label>GSTR-2B (confirmed batch)</Label>
                  <Select value={gstr2bBatchId} onValueChange={setGstr2bBatchId}>
                    <SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger>
                    <SelectContent>{confirmedBatches.filter(b => b.direction === "gstr2b").map(b => <SelectItem key={b.id} value={b.id}>{b.fileName} ({b.period})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={runReconcile} disabled={reconciling} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{reconciling && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Run Reconciliation</Button>
            </CardContent>
          </Card>

          {reconRun && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4">
                <h3 className="font-heading text-lg text-ct-navy mb-3">Results — {reconRun.period}</h3>
                <div className="flex flex-wrap gap-2">
                  <Badge className={MATCH_COLORS.exact}>Exact: {reconRun.exactMatches}</Badge>
                  <Badge className={MATCH_COLORS.probable}>Probable: {reconRun.probableMatches}</Badge>
                  <Badge className={MATCH_COLORS.mismatch}>Mismatches: {reconRun.mismatches}</Badge>
                  <Badge className={MATCH_COLORS.missing_in_2b}>Missing in 2B: {reconRun.missingIn2b}</Badge>
                  <Badge className={MATCH_COLORS.missing_in_books}>Missing in Books: {reconRun.missingInBooks}</Badge>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="returns" className="space-y-4">
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-4 space-y-3">
              <div className="flex gap-4">
                <div className="flex-1"><Label>GSTIN</Label><Input value={returnGstin} onChange={e => setReturnGstin(e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" /></div>
                <div className="flex-1"><Label>Period (YYYY-MM)</Label><Input value={returnPeriod} onChange={e => setReturnPeriod(e.target.value)} placeholder="2026-06" /></div>
                <div className="flex-1"><Label>Return</Label>
                  <Select value={returnType} onValueChange={setReturnType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="gstr1">GSTR-1</SelectItem><SelectItem value="gstr3b">GSTR-3B</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={generateReturn} disabled={generating} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{generating && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Generate</Button>
            </CardContent>
          </Card>

          {generatedReturn && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-heading text-lg text-ct-navy">{generatedReturn.returnType.toUpperCase()} — {generatedReturn.period}</h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={downloadReturnJson}><FileJson className="w-3.5 h-3.5 mr-1" />Download JSON</Button>
                    <Button size="sm" onClick={runAiReview} disabled={reviewing} className="bg-ct-navy hover:bg-ct-navy/90 text-white"><Sparkles className="w-3.5 h-3.5 mr-1" />{reviewing ? "Reviewing…" : "AI Review"}</Button>
                  </div>
                </div>
                <pre className="text-xs bg-ct-cloud/40 p-3 rounded-lg overflow-auto max-h-64">{JSON.stringify(generatedReturn.summary, null, 2)}</pre>

                {aiReview && (
                  <div className="border-t border-ct-border pt-3">
                    <Badge className={aiReview.verdict === "high" ? "bg-red-100 text-red-700" : aiReview.verdict === "medium" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}>
                      Risk: {aiReview.verdict}
                    </Badge>
                    <p className="text-sm text-ct-navy mt-2">{aiReview.summary}</p>
                    <div className="space-y-2 mt-2">
                      {aiReview.topIssues.map((issue, i) => (
                        <div key={i} className="text-sm border-l-2 border-ct-teal pl-3">
                          <p className="font-medium text-ct-navy">{issue.title}{issue.amountAtStake ? ` — ₹${issue.amountAtStake.toLocaleString("en-IN")}` : ""}</p>
                          <p className="text-ct-muted text-xs">{issue.recommendation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
