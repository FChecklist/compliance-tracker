"use client";

export const dynamic = "force-dynamic";

// Wave 50 (VERI ERP gap-fill): first real UI on top of the Wave 49 schema
// scaffold -- chart of accounts (quick-add) + journal entry create/submit,
// wired to the new accounting-period lock and shared approval-workflow
// engine on submit (see erp-accounting-service.ts).
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Account = { id: string; accountName: string; accountNumber: string | null; rootType: string; accountType: string | null };
type JournalEntry = { id: string; entryNumber: number; postingDate: string; status: string; totalDebit: string; totalCredit: string; userRemark: string | null };
type Line = { accountId: string; debit: string; credit: string };
type CostCenter = { id: string; name: string; isGroup: boolean };

const ROOT_TYPES = ["asset", "liability", "equity", "income", "expense"];
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-ct-cloud text-ct-muted",
  submitted: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

export default function ErpJournalEntriesPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);

  const [acctOpen, setAcctOpen] = useState(false);
  const [acctName, setAcctName] = useState("");
  const [acctRootType, setAcctRootType] = useState("asset");
  const [acctType, setAcctType] = useState("");
  const [creatingAcct, setCreatingAcct] = useState(false);

  const [ccOpen, setCcOpen] = useState(false);
  const [ccName, setCcName] = useState("");
  const [creatingCc, setCreatingCc] = useState(false);

  const [jeOpen, setJeOpen] = useState(false);
  const [postingDate, setPostingDate] = useState(new Date().toISOString().slice(0, 10));
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<Line[]>([{ accountId: "", debit: "", credit: "" }, { accountId: "", debit: "", credit: "" }]);
  const [creatingJe, setCreatingJe] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([fetch("/api/erp/accounts"), fetch("/api/erp/journal-entries"), fetch("/api/erp/cost-centers")])
      .then(([acctRes, jeRes, ccRes]) => Promise.all([acctRes.json(), jeRes.json(), ccRes.json()]))
      .then(([acctData, jeData, ccData]) => {
        setAccounts(acctData.accounts ?? []);
        setEntries(jeData.entries ?? []);
        setCostCenters(ccData.costCenters ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const createCostCenter = async () => {
    if (!ccName.trim()) return;
    setCreatingCc(true);
    const res = await fetch("/api/erp/cost-centers", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: ccName }),
    });
    setCreatingCc(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create cost center"); return; }
    setCcOpen(false); setCcName("");
    toast.success("Cost center created");
    load();
  };

  const createAccount = async () => {
    if (!acctName.trim()) return;
    setCreatingAcct(true);
    const res = await fetch("/api/erp/accounts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountName: acctName, rootType: acctRootType, accountType: acctType || undefined }),
    });
    setCreatingAcct(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create account"); return; }
    setAcctOpen(false); setAcctName(""); setAcctType("");
    toast.success("Account created");
    load();
  };

  const updateLine = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, { accountId: "", debit: "", credit: "" }]);
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);

  const createJournalEntry = async () => {
    setCreatingJe(true);
    const res = await fetch("/api/erp/journal-entries", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postingDate, userRemark: remark || undefined,
        lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
      }),
    });
    setCreatingJe(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create journal entry"); return; }
    setJeOpen(false); setRemark(""); setLines([{ accountId: "", debit: "", credit: "" }, { accountId: "", debit: "", credit: "" }]);
    toast.success("Journal entry created as draft");
    load();
  };

  const submitEntry = async (id: string) => {
    setSubmittingId(id);
    const res = await fetch(`/api/erp/journal-entries/${id}/submit`, { method: "POST" });
    setSubmittingId(null);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error ?? "Failed to submit"); return; }
    toast.success(d.pendingApproval ? "Sent for approval" : "Posted to the general ledger");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Journal Entries</h1>
          <p className="text-sm text-ct-muted mt-1">Chart of accounts &amp; double-entry postings — VERI ERP AI</p>
        </div>
      </div>

      <Tabs defaultValue="entries">
        <TabsList>
          <TabsTrigger value="entries">Journal Entries</TabsTrigger>
          <TabsTrigger value="accounts">Chart of Accounts</TabsTrigger>
          <TabsTrigger value="costcenters">Cost Centers</TabsTrigger>
        </TabsList>

        <TabsContent value="entries" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={jeOpen} onOpenChange={setJeOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Journal Entry</Button></DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>New Journal Entry</DialogTitle><DialogDescription>Debits must equal credits before this can be submitted.</DialogDescription></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Posting Date</Label><Input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} /></div>
                    <div><Label>Remark</Label><Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Optional" /></div>
                  </div>
                  <div className="space-y-2">
                    {lines.map((line, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Select value={line.accountId} onValueChange={(v) => updateLine(i, { accountId: v })}>
                          <SelectTrigger className="flex-1"><SelectValue placeholder="Account" /></SelectTrigger>
                          <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input className="w-28" type="number" placeholder="Debit" value={line.debit} onChange={(e) => updateLine(i, { debit: e.target.value, credit: "" })} />
                        <Input className="w-28" type="number" placeholder="Credit" value={line.credit} onChange={(e) => updateLine(i, { credit: e.target.value, debit: "" })} />
                        <Button size="sm" variant="ghost" onClick={() => removeLine(i)} disabled={lines.length <= 2}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={addLine}><Plus className="w-3 h-3 mr-1" />Add line</Button>
                  </div>
                  <div className={`text-sm flex justify-end gap-4 ${Math.abs(totalDebit - totalCredit) > 0.01 ? "text-red-600" : "text-ct-teal"}`}>
                    <span>Debit: {totalDebit.toFixed(2)}</span><span>Credit: {totalCredit.toFixed(2)}</span>
                  </div>
                </div>
                <DialogFooter><Button onClick={createJournalEntry} disabled={creatingJe || Math.abs(totalDebit - totalCredit) > 0.01} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingJe && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save as Draft</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card className="rounded-xl shadow-card bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border">
                  <th className="p-3 font-medium">#</th><th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Remark</th><th className="p-3 font-medium">Debit</th><th className="p-3 font-medium">Credit</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th>
                </tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={7} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : entries.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-ct-muted">No journal entries yet.</td></tr>
                    : entries.map((e) => (
                      <tr key={e.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{e.entryNumber}</td><td className="p-3">{e.postingDate}</td><td className="p-3">{e.userRemark ?? "—"}</td>
                        <td className="p-3">{Number(e.totalDebit).toFixed(2)}</td><td className="p-3">{Number(e.totalCredit).toFixed(2)}</td>
                        <td className="p-3"><Badge className={STATUS_COLORS[e.status] ?? ""}>{e.status}</Badge></td>
                        <td className="p-3">{e.status === "draft" && <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={() => submitEntry(e.id)} disabled={submittingId === e.id}>{submittingId === e.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Submit</Button>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="accounts" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={acctOpen} onOpenChange={setAcctOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Account</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Account</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Account Name</Label><Input value={acctName} onChange={(e) => setAcctName(e.target.value)} /></div>
                  <div><Label>Root Type</Label>
                    <Select value={acctRootType} onValueChange={setAcctRootType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ROOT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Account Type (optional)</Label><Input value={acctType} onChange={(e) => setAcctType(e.target.value)} placeholder="e.g. bank, cash, receivable, payable" /></div>
                </div>
                <DialogFooter><Button onClick={createAccount} disabled={creatingAcct} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingAcct && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Create</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Number</th><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Root Type</th><th className="p-3 font-medium">Account Type</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {accounts.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">No accounts yet — create your chart of accounts to get started.</td></tr>
                    : accounts.map((a) => <tr key={a.id} className="hover:bg-ct-row-hover"><td className="p-3">{a.accountNumber ?? "—"}</td><td className="p-3">{a.accountName}</td><td className="p-3 capitalize">{a.rootType}</td><td className="p-3">{a.accountType ?? "—"}</td></tr>)}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="costcenters" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={ccOpen} onOpenChange={setCcOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Cost Center</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Cost Center</DialogTitle><DialogDescription>Tag journal entry lines to track spend by department, project, or business unit.</DialogDescription></DialogHeader>
                <div><Label>Name</Label><Input value={ccName} onChange={(e) => setCcName(e.target.value)} /></div>
                <DialogFooter><Button onClick={createCostCenter} disabled={creatingCc} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingCc && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Create</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Name</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {costCenters.length === 0 ? <tr><td className="p-6 text-center text-ct-muted">No cost centers yet.</td></tr>
                    : costCenters.map((c) => <tr key={c.id} className="hover:bg-ct-row-hover"><td className="p-3">{c.name}</td></tr>)}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
