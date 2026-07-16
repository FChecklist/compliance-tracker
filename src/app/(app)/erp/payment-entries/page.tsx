"use client";

export const dynamic = "force-dynamic";

// Wave B (VERIDIAN Review Framework remediation): first real UI on top of
// the Wave 49 erp_payment_entries schema -- create/submit/decide, plus a
// full audit trail of who approved/rejected and when. Deliberately no
// payment-gateway UI anywhere on this page (no "Pay Now", no Razorpay
// widget) -- Owner directive: approval/record-keeping only.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, CheckCircle2, XCircle, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useMe } from "@/lib/queries/use-me";

type BankAccount = { id: string; accountName: string; bankName: string | null };
type Customer = { id: string; customerName: string };
type Supplier = { id: string; supplierName: string };
type Invoice = { id: string; invoiceNumber: number; customerId?: string; supplierId?: string; outstandingAmount: string; status: string };
type PaymentEntry = {
  id: string; paymentType: "receive" | "pay"; partyType: "customer" | "supplier"; partyId: string; partyName: string | null;
  paidAmount: string; receivedAmount: string; bankAccountId: string | null; referenceNo: string | null; postingDate: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "cancelled";
  invoiceType: string | null; invoiceId: string | null; createdById: string | null; decidedById: string | null; decidedAt: string | null; decisionComment: string | null;
};
type AuditEntry = { id: string; action: string; actorName: string | null; actorRole: string | null; createdAt: string; details: string | null };

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-ct-cloud text-ct-muted",
  submitted: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-ct-cloud text-ct-muted",
};

const MANAGER_RANKS = new Set(["manager", "senior_professional", "branch_manager", "admin", "veridian_admin"]);

function amountOf(e: PaymentEntry): number {
  return e.paymentType === "receive" ? Number(e.receivedAmount) : Number(e.paidAmount);
}

export default function ErpPaymentEntriesPage() {
  const { data: me } = useMe();
  const canDecide = Boolean(me?.role && MANAGER_RANKS.has(me.role));

  const [entries, setEntries] = useState<PaymentEntry[]>([]);
  const [pending, setPending] = useState<PaymentEntry[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [salesInvoices, setSalesInvoices] = useState<Invoice[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<"receive" | "pay">("receive");
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [postingDate, setPostingDate] = useState(new Date().toISOString().slice(0, 10));
  const [referenceNo, setReferenceNo] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<(PaymentEntry & { invoice: { invoiceNumber: number; outstandingAmount: string; status: string } | null }) | null>(null);
  const [auditTrail, setAuditTrail] = useState<AuditEntry[]>([]);
  const [decisionComment, setDecisionComment] = useState("");
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/erp/payment-entries"), fetch("/api/erp/payment-entries/pending-approvals"),
      fetch("/api/erp/bank-accounts"), fetch("/api/erp/selling/customers"), fetch("/api/erp/buying/suppliers"),
      fetch("/api/erp/sales-invoices"), fetch("/api/erp/purchase-invoices"),
    ])
      .then((responses) => Promise.all(responses.map((r) => r.json())))
      .then(([peData, pendingData, bankData, custData, suppData, siData, piData]) => {
        setEntries(peData.entries ?? []);
        setPending(pendingData.entries ?? []);
        setBankAccounts(bankData.bankAccounts ?? []);
        setCustomers(custData.customers ?? []);
        setSuppliers(suppData.suppliers ?? []);
        setSalesInvoices(siData.invoices ?? []);
        setPurchaseInvoices(piData.invoices ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const partyOptions = paymentType === "receive" ? customers.map((c) => ({ id: c.id, label: c.customerName })) : suppliers.map((s) => ({ id: s.id, label: s.supplierName }));
  const openInvoices = paymentType === "receive"
    ? salesInvoices.filter((i) => i.customerId === partyId && ["submitted", "partially_paid", "overdue"].includes(i.status))
    : purchaseInvoices.filter((i) => i.supplierId === partyId && ["submitted", "partially_paid", "overdue"].includes(i.status));

  const resetCreateForm = () => {
    setPaymentType("receive"); setPartyId(""); setAmount(""); setBankAccountId("");
    setPostingDate(new Date().toISOString().slice(0, 10)); setReferenceNo(""); setInvoiceId("");
  };

  const createEntry = async () => {
    if (!partyId || !amount || !bankAccountId) { toast.error("Party, amount, and bank account are required"); return; }
    setCreating(true);
    const res = await fetch("/api/erp/payment-entries", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentType, partyType: paymentType === "receive" ? "customer" : "supplier", partyId,
        amount: Number(amount), bankAccountId, postingDate, referenceNo: referenceNo || undefined,
        invoiceType: invoiceId ? (paymentType === "receive" ? "sales_invoice" : "purchase_invoice") : undefined,
        invoiceId: invoiceId || undefined,
      }),
    });
    setCreating(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create payment entry"); return; }
    setCreateOpen(false); resetCreateForm();
    toast.success("Payment entry created as draft");
    load();
  };

  const submitEntry = async (id: string) => {
    setBusyId(id);
    const res = await fetch(`/api/erp/payment-entries/${id}/submit`, { method: "POST" });
    setBusyId(null);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error ?? "Failed to submit"); return; }
    toast.success("Sent for approval");
    load();
  };

  const cancelEntry = async (id: string) => {
    setBusyId(id);
    const res = await fetch(`/api/erp/payment-entries/${id}/cancel`, { method: "POST" });
    setBusyId(null);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error ?? "Failed to cancel"); return; }
    toast.success("Payment entry cancelled");
    load();
  };

  const openDetail = async (id: string) => {
    setDetailId(id); setDetail(null); setAuditTrail([]); setDecisionComment("");
    const [entryRes, auditRes] = await Promise.all([fetch(`/api/erp/payment-entries/${id}`), fetch(`/api/erp/payment-entries/${id}/audit-log`)]);
    const entryData = await entryRes.json().catch(() => null);
    const auditData = await auditRes.json().catch(() => ({ entries: [] }));
    if (entryRes.ok) setDetail(entryData);
    setAuditTrail(auditData.entries ?? []);
  };

  const decide = async (decision: "approved" | "rejected") => {
    if (!detailId) return;
    setDeciding(true);
    const res = await fetch(`/api/erp/payment-entries/${detailId}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, comment: decisionComment || undefined }),
    });
    setDeciding(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error ?? "Failed to record decision"); return; }
    toast.success(decision === "approved" ? "Payment entry approved and posted to the general ledger" : "Payment entry rejected");
    setDetailId(null);
    load();
  };

  const renderTable = (rows: PaymentEntry[], emptyLabel: string) => (
    <Card className="rounded-xl shadow-card bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-ct-muted border-b border-ct-border">
            <th className="p-3 font-medium">Party</th><th className="p-3 font-medium">Type</th><th className="p-3 font-medium">Amount</th>
            <th className="p-3 font-medium">Posting Date</th><th className="p-3 font-medium">Reference</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th>
          </tr></thead>
          <tbody className="divide-y divide-ct-border">
            {loading ? <tr><td colSpan={7} className="p-6 text-center text-ct-muted">Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-ct-muted">{emptyLabel}</td></tr>
              : rows.map((e) => (
                <tr key={e.id} className="hover:bg-ct-row-hover">
                  <td className="p-3">{e.partyName ?? "—"}</td>
                  <td className="p-3 capitalize">{e.paymentType === "receive" ? "Receive" : "Pay"}</td>
                  <td className="p-3">{amountOf(e).toFixed(2)}</td>
                  <td className="p-3">{e.postingDate}</td>
                  <td className="p-3">{e.referenceNo ?? "—"}</td>
                  <td className="p-3"><Badge className={STATUS_COLORS[e.status] ?? ""}>{e.status}</Badge></td>
                  <td className="p-3 flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openDetail(e.id)}><Eye className="w-3 h-3 mr-1" />View</Button>
                    {e.status === "draft" && <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={() => submitEntry(e.id)} disabled={busyId === e.id}>{busyId === e.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Submit</Button>}
                    {e.status === "draft" && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => cancelEntry(e.id)} disabled={busyId === e.id}>Cancel</Button>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Payment Entries</h1>
          <p className="text-sm text-ct-muted mt-1">Record and approve payments — VERI ERP AI. Approval/record-keeping only, no live payment gateway is wired up here.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetCreateForm(); }}>
          <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Payment Entry</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Payment Entry</DialogTitle><DialogDescription>Saved as a draft first -- submit it to send it for a manager-rank approval decision.</DialogDescription></DialogHeader>
            <div className="space-y-3">
              <div><Label>Payment Type</Label>
                <Select value={paymentType} onValueChange={(v) => { setPaymentType(v as "receive" | "pay"); setPartyId(""); setInvoiceId(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="receive">Receive (from a customer)</SelectItem><SelectItem value="pay">Pay (to a supplier)</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>{paymentType === "receive" ? "Customer" : "Supplier"}</Label>
                <Select value={partyId} onValueChange={(v) => { setPartyId(v); setInvoiceId(""); }}>
                  <SelectTrigger><SelectValue placeholder={`Select a ${paymentType === "receive" ? "customer" : "supplier"}`} /></SelectTrigger>
                  <SelectContent>{partyOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Amount</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                <div><Label>Posting Date</Label><Input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} /></div>
              </div>
              <div><Label>Bank Account</Label>
                <Select value={bankAccountId} onValueChange={setBankAccountId}>
                  <SelectTrigger><SelectValue placeholder="Select a bank account" /></SelectTrigger>
                  <SelectContent>{bankAccounts.map((b) => <SelectItem key={b.id} value={b.id}>{b.accountName}{b.bankName ? ` — ${b.bankName}` : ""}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Reference No (optional)</Label><Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="e.g. cheque / transfer reference" /></div>
              {partyId && (
                <div><Label>Apply against an invoice (optional)</Label>
                  <Select value={invoiceId || "__none__"} onValueChange={(v) => setInvoiceId(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="No invoice link -- standalone payment" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No invoice link</SelectItem>
                      {openInvoices.map((i) => <SelectItem key={i.id} value={i.id}>#{i.invoiceNumber} — outstanding {Number(i.outstandingAmount).toFixed(2)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <DialogFooter><Button onClick={createEntry} disabled={creating} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creating && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save as Draft</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All Payment Entries</TabsTrigger>
          <TabsTrigger value="pending">Awaiting My Approval{pending.length > 0 ? ` (${pending.length})` : ""}</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="space-y-3">{renderTable(entries, "No payment entries yet.")}</TabsContent>
        <TabsContent value="pending" className="space-y-3">
          {!canDecide && <p className="text-sm text-ct-muted">Deciding a payment entry requires manager role or higher.</p>}
          {renderTable(pending, "Nothing is awaiting your approval right now.")}
        </TabsContent>
      </Tabs>

      <Dialog open={detailId !== null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Payment Entry</DialogTitle></DialogHeader>
          {!detail ? <div className="py-6 text-center text-ct-muted"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading…</div> : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-ct-muted">Party</span><div>{detail.partyName ?? "—"}</div></div>
                <div><span className="text-ct-muted">Type</span><div className="capitalize">{detail.paymentType}</div></div>
                <div><span className="text-ct-muted">Amount</span><div>{amountOf(detail).toFixed(2)}</div></div>
                <div><span className="text-ct-muted">Posting Date</span><div>{detail.postingDate}</div></div>
                <div><span className="text-ct-muted">Status</span><div><Badge className={STATUS_COLORS[detail.status] ?? ""}>{detail.status}</Badge></div></div>
                <div><span className="text-ct-muted">Reference</span><div>{detail.referenceNo ?? "—"}</div></div>
                {detail.invoice && (
                  <div className="col-span-2"><span className="text-ct-muted">Linked invoice</span><div>#{detail.invoice.invoiceNumber} ({detail.invoice.status}, outstanding {Number(detail.invoice.outstandingAmount).toFixed(2)})</div></div>
                )}
              </div>

              {detail.status === "submitted" && (
                <div className="space-y-2 border-t border-ct-border pt-3">
                  <Label>Decision comment (optional)</Label>
                  <Textarea value={decisionComment} onChange={(e) => setDecisionComment(e.target.value)} placeholder="Add a note for the audit trail" />
                  {!canDecide && <p className="text-xs text-ct-muted">This action requires manager role or higher.</p>}
                  {canDecide && detail.createdById === me?.id && <p className="text-xs text-ct-muted">You submitted this entry -- an independent approver is required.</p>}
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="outline" className="text-red-600 border-red-200" disabled={deciding || !canDecide} onClick={() => decide("rejected")}><XCircle className="w-3.5 h-3.5 mr-1" />Reject</Button>
                    <Button size="sm" className="bg-ct-teal hover:bg-ct-teal-hover text-white" disabled={deciding || !canDecide} onClick={() => decide("approved")}>{deciding && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}<CheckCircle2 className="w-3.5 h-3.5 mr-1" />Approve</Button>
                  </div>
                </div>
              )}

              <div className="border-t border-ct-border pt-3">
                <Label className="mb-2 block">Audit Trail</Label>
                {auditTrail.length === 0 ? <p className="text-xs text-ct-muted">No activity recorded yet.</p> : (
                  <ul className="space-y-2 text-xs">
                    {auditTrail.map((a) => (
                      <li key={a.id} className="flex justify-between gap-2">
                        <span>{a.action.replace("erp_payment_entry.", "")} — {a.actorName ?? "Unknown"} ({a.actorRole ?? "—"})</span>
                        <span className="text-ct-muted whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
