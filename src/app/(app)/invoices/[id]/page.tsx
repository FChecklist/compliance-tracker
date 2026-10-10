"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own InvoiceObjectClient.tsx (the Invoice Object Page: line
// items, Submit -- post to ledger, Record Payment, and Cancel). Reads/
// writes the SAME GET /api/v1/projexa/sales-invoices/{id}, POST .../submit,
// POST .../payments and POST .../cancel routes this app's backend already
// serves (getSalesInvoice/submitSalesInvoice/recordSalesInvoicePayment/
// cancelSalesInvoice in erp-invoicing-service.ts) -- zero new backend
// route. GET /api/v1/projexa/accounts supplies the revenue-account and
// bank/cash-account pickers, matching PROJEXA's own screen exactly.
//
// Real Delete = real Cancel (cancelSalesInvoice, status -> 'cancelled'),
// draft only -- the same convention src/app/(app)/purchase-orders/[id]/
// page.tsx already documents for this port. Line items are not editable
// here -- there is no update-line-items route upstream, matching
// PROJEXA's own screen (display-only line table).
//
// Rebuilt on this repo's own Card/Table/Select (matching
// src/app/(app)/purchase-orders/[id]/page.tsx), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type InvoiceItem = { id: string; description: string; quantity: string; rate: string; amount: string; hsnSacCode: string | null };
type Invoice = {
  id: string; invoiceNumber: number; customerId: string; customerName: string | null; postingDate: string; dueDate: string | null;
  subtotal: string; taxAmount: string; grandTotal: string; outstandingAmount: string; status: string; items: InvoiceItem[];
};
type Account = { id: string; accountName: string; accountNumber: string | null; rootType: string | null; accountType: string | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", partially_paid: "secondary", paid: "default", overdue: "destructive", cancelled: "destructive",
};

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const invoiceId = params.id;
  const currencies = useCurrencies();
  const money = (v: string | number) => `${currencyLabel(undefined, currencies)}${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const [revenueAccountId, setRevenueAccountId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, acctRes] = await Promise.all([
        fetch(`/api/v1/projexa/sales-invoices/${encodeURIComponent(invoiceId)}`),
        fetch("/api/v1/projexa/accounts").catch(() => null),
      ]);
      const invBody = await invRes.json().catch(() => null);
      if (!invRes.ok) throw new Error(invBody?.error ?? "Couldn't load this invoice");
      setInvoice(invBody as Invoice);
      setPaymentAmount(invBody.outstandingAmount);
      if (acctRes && acctRes.ok) {
        const acctBody = await acctRes.json().catch(() => ({}));
        setAccounts(acctBody.accounts ?? []);
      }
      setLoadError(null);
    } catch (err) {
      setInvoice(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this invoice");
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => { void load(); }, [load]);

  async function submitInvoice() {
    if (!revenueAccountId) { toast.error("Choose a revenue account first"); return; }
    setActionBusy("submit");
    try {
      const res = await fetch(`/api/v1/projexa/sales-invoices/${encodeURIComponent(invoiceId)}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revenueAccountId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to submit invoice");
      toast.success("Invoice posted to the ledger");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit invoice");
    } finally {
      setActionBusy(null);
    }
  }

  async function recordPayment() {
    if (!paymentAmount || !paymentAccountId) { toast.error("Amount and bank/cash account are required"); return; }
    setActionBusy("payment");
    try {
      const res = await fetch(`/api/v1/projexa/sales-invoices/${encodeURIComponent(invoiceId)}/payments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(paymentAmount), bankOrCashAccountId: paymentAccountId, postingDate: paymentDate }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to record payment");
      toast.success("Payment recorded");
      setPaymentAccountId("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record payment");
    } finally {
      setActionBusy(null);
    }
  }

  async function cancelInvoice() {
    if (!invoice) return;
    const sentence = `Cancel Invoice #${invoice.invoiceNumber}? This is a cancellation, not a row delete: it stays on file as 'cancelled'. This cannot be undone.`;
    if (!confirm(sentence)) return;
    setActionBusy("cancel");
    try {
      const res = await fetch(`/api/v1/projexa/sales-invoices/${encodeURIComponent(invoiceId)}/cancel`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to cancel invoice");
      toast.success("Invoice cancelled");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel invoice");
    } finally {
      setActionBusy(null);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !invoice) {
    return (
      <div className="space-y-3">
        <Link href="/invoices" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" />Back to Invoices
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Invoice not found."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  const revenueAccounts = accounts.filter((a) => a.rootType === "income");
  // accountType is free text (admin-extensible, per erp-accounts schema
  // comment) -- matching PROJEXA's own InvoiceObjectClient.tsx, this is a
  // case-insensitive match since real data has both "bank" and "Bank" for
  // the same org.
  const bankAccounts = accounts.filter((a) => a.accountType?.toLowerCase() === "bank" || a.accountType?.toLowerCase() === "cash");
  const canRecordPayment = ["submitted", "partially_paid", "overdue"].includes(invoice.status);
  const isDraft = invoice.status === "draft";

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/invoices?tab=invoices")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Invoices
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">Invoice #{invoice.invoiceNumber}</h1>
            <Badge variant={STATUS_VARIANT[invoice.status] ?? "outline"} className="capitalize">{invoice.status.replace(/_/g, " ")}</Badge>
          </div>
          {isDraft && (
            <Button
              variant="outline" size="sm" disabled={actionBusy !== null}
              className="text-red-700 border-red-200 hover:bg-red-50"
              onClick={cancelInvoice}
            >
              {actionBusy === "cancel" ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              Cancel Invoice
            </Button>
          )}
        </div>
        <p className="text-sm text-ct-muted mt-1">
          Customer: {invoice.customerName ?? "—"} &middot; Posting Date: {invoice.postingDate} &middot; Due Date: {invoice.dueDate ?? "—"} &middot; Outstanding: {money(invoice.outstandingAmount)}
        </p>
      </div>

      {isDraft && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">Submit (Post to Ledger)</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Revenue Account</Label>
              <Select value={revenueAccountId} onValueChange={setRevenueAccountId}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Select a revenue account" /></SelectTrigger>
                <SelectContent>{revenueAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button size="sm" disabled={actionBusy !== null || !revenueAccountId} onClick={submitInvoice} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {actionBusy === "submit" ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Send className="size-3.5 mr-1" />}
              {actionBusy === "submit" ? "Posting…" : "Submit"}
            </Button>
          </CardContent>
        </Card>
      )}

      {canRecordPayment && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">Record Payment</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Amount</Label>
              <Input type="number" className="w-32" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Bank / Cash Account</Label>
              <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                <SelectTrigger className="w-56"><SelectValue placeholder={bankAccounts.length ? "Select an account" : "None found"} /></SelectTrigger>
                <SelectContent>{bankAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Posting Date</Label>
              <Input type="date" className="w-40" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
            <Button size="sm" disabled={actionBusy !== null || !paymentAmount || !paymentAccountId} onClick={recordPayment} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {actionBusy === "payment" ? "Recording…" : "Record Payment"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Line Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Description</TableHead><TableHead>HSN/SAC</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.description}</TableCell>
                  <TableCell className="text-ct-muted">{i.hsnSacCode ?? "—"}</TableCell>
                  <TableCell className="text-right">{Number(i.quantity).toLocaleString()}</TableCell>
                  <TableCell className="text-right">{money(i.rate)}</TableCell>
                  <TableCell className="text-right">{money(i.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
        <div className="flex justify-end gap-6 border-t px-4 py-3 text-sm">
          <div><span className="text-ct-muted">Subtotal: </span><span className="font-medium text-ct-navy">{money(invoice.subtotal)}</span></div>
          <div><span className="text-ct-muted">Tax: </span><span className="font-medium text-ct-navy">{money(invoice.taxAmount)}</span></div>
          <div><span className="text-ct-muted">Grand Total: </span><span className="font-medium text-ct-navy">{money(invoice.grandTotal)}</span></div>
        </div>
      </Card>
    </div>
  );
}
