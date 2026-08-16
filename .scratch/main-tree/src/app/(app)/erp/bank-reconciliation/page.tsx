"use client";

export const dynamic = "force-dynamic";

// Wave 54 (VERI ERP gap-fill, Tier 3 #9): Bank Statement Import &
// Reconciliation. Reuses VERIDIAN's own generic file parser (CSV/Excel)
// rather than a new MT940 dependency -- see VAIOS_ARCHITECTURE_STRATEGY.md.
import { Fragment, useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type BankAccount = { id: string; accountName: string; glAccountId: string | null };
type Imp = { id: string; fileName: string; totalLines: number; importedAt: string };
type Line = { id: string; transactionDate: string; description: string | null; debitAmount: string; creditAmount: string; status: string };
type Candidate = { journalEntryId: string; entryNumber: number; postingDate: string; amount: string };

const STATUS_COLORS: Record<string, string> = { unmatched: "bg-ct-cloud text-ct-muted", matched: "bg-green-100 text-green-700", ignored: "bg-red-100 text-red-700" };

export default function ErpBankReconciliationPage() {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [imports, setImports] = useState<Imp[]>([]);
  const [selectedImportId, setSelectedImportId] = useState<string>("");
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({});

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBankAccountId, setUploadBankAccountId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(() => {
    Promise.all([fetch("/api/erp/bank-accounts"), fetch("/api/erp/bank-reconciliation")])
      .then(([baRes, impRes]) => Promise.all([baRes.json(), impRes.json()]))
      .then(([baData, impData]) => {
        setBankAccounts(baData.bankAccounts ?? []);
        setImports(impData.imports ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const loadLines = useCallback((importId: string) => {
    Promise.resolve().then(() => {
      if (!importId) { setLines([]); return undefined; }
      return fetch(`/api/erp/bank-reconciliation/${importId}/lines`).then((r) => r.json()).then((d) => setLines(d.lines ?? []));
    }).catch(() => setLines([]));
  }, []);

  useEffect(() => { loadLines(selectedImportId); }, [selectedImportId, loadLines]);

  const upload = async () => {
    if (!uploadFile || !uploadBankAccountId) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("bankAccountId", uploadBankAccountId);
    const res = await fetch("/api/erp/bank-reconciliation/import", { method: "POST", body: formData });
    setUploading(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to import statement"); return; }
    setUploadOpen(false); setUploadFile(null);
    toast.success("Bank statement imported");
    load();
  };

  const findMatches = async (lineId: string) => {
    const account = bankAccounts.find((a) => a.id === uploadBankAccountId) ?? bankAccounts[0];
    if (!account?.glAccountId) { toast.error("This bank account has no linked GL account"); return; }
    const res = await fetch(`/api/erp/bank-reconciliation/lines/${lineId}/suggest?bankGlAccountId=${account.glAccountId}`);
    const d = await res.json();
    setCandidates((prev) => ({ ...prev, [lineId]: d.candidates ?? [] }));
    if (!d.candidates?.length) toast.info("No candidate journal entries found in the +/-5 day window");
  };

  const matchLine = async (lineId: string, journalEntryId: string) => {
    const res = await fetch(`/api/erp/bank-reconciliation/lines/${lineId}/match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ journalEntryId }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to match"); return; }
    toast.success("Matched");
    loadLines(selectedImportId);
  };

  const ignoreLine = async (lineId: string) => {
    const res = await fetch(`/api/erp/bank-reconciliation/lines/${lineId}/ignore`, { method: "POST" });
    if (!res.ok) { toast.error("Failed to ignore"); return; }
    loadLines(selectedImportId);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Bank Reconciliation</h1>
          <p className="text-sm text-ct-muted mt-1">Import bank statements (CSV/Excel) and match against journal entries — VERI ERP AI</p>
        </div>
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Upload className="w-4 h-4 mr-1" />Import Statement</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Import Bank Statement</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Bank Account</Label>
                <Select value={uploadBankAccountId} onValueChange={setUploadBankAccountId}>
                  <SelectTrigger><SelectValue placeholder="Select bank account" /></SelectTrigger>
                  <SelectContent>{bankAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Statement File (CSV or Excel)</Label>
                <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} className="text-sm" />
              </div>
            </div>
            <DialogFooter><Button onClick={upload} disabled={uploading || !uploadFile || !uploadBankAccountId} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{uploading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Import</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-4">
        <div className="w-64">
          <Label>Statement Import</Label>
          <Select value={selectedImportId} onValueChange={setSelectedImportId}>
            <SelectTrigger><SelectValue placeholder="Select an import" /></SelectTrigger>
            <SelectContent>{imports.map((i) => <SelectItem key={i.id} value={i.id}>{i.fileName} ({i.totalLines} lines)</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Description</th><th className="p-3 font-medium text-right">Debit</th><th className="p-3 font-medium text-right">Credit</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
            <tbody className="divide-y divide-ct-border">
              {loading ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                : !selectedImportId ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">Select a statement import above.</td></tr>
                : lines.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">No lines in this import.</td></tr>
                : lines.map((l) => (
                  <Fragment key={l.id}>
                    <tr className="hover:bg-ct-row-hover">
                      <td className="p-3">{l.transactionDate}</td><td className="p-3">{l.description ?? "—"}</td>
                      <td className="p-3 text-right">{Number(l.debitAmount) > 0 ? Number(l.debitAmount).toFixed(2) : "—"}</td>
                      <td className="p-3 text-right">{Number(l.creditAmount) > 0 ? Number(l.creditAmount).toFixed(2) : "—"}</td>
                      <td className="p-3"><Badge className={STATUS_COLORS[l.status] ?? ""}>{l.status}</Badge></td>
                      <td className="p-3">
                        {l.status === "unmatched" && (
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => findMatches(l.id)}>Find Matches</Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => ignoreLine(l.id)}>Ignore</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {candidates[l.id] && candidates[l.id].length > 0 && (
                      <tr>
                        <td colSpan={6} className="p-2 bg-ct-cloud/30">
                          <div className="flex gap-2 flex-wrap">
                            {candidates[l.id].map((c) => (
                              <Button key={c.journalEntryId} size="sm" variant="outline" className="h-7 text-xs" onClick={() => matchLine(l.id, c.journalEntryId)}>
                                Match JE #{c.entryNumber} ({c.postingDate}, {Number(c.amount).toFixed(2)})
                              </Button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
