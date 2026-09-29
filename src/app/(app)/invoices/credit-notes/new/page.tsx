"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own CreditNoteCreateClient.tsx -- a repeatable line-item editor
// (description/qty/rate, add/remove a row, last row not removable) with a
// running credit total, against a chosen sales invoice. POSTs to the SAME
// POST /api/v1/projexa/credit-notes this app's backend already serves
// (createSalesCreditNote in erp-credit-note-service.ts) -- zero new
// backend route. The "Against Invoice" picker reads the SAME
// GET /api/v1/projexa/sales-invoices?limit=100 PROJEXA's own screen reads.
//
// Rebuilt on this repo's own Card/Input/Select (matching
// src/app/(app)/purchase-orders/new/page.tsx), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Invoice = { id: string; invoiceNumber: number; customerId: string; customerName: string | null };
type Line = { description: string; quantity: string; rate: string };

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function blankLine(): Line {
  return { description: "", quantity: "1", rate: "" };
}

export default function CreditNoteNewPage() {
  const router = useRouter();
  const currencies = useCurrencies();
  const money = (v: number) => `${currencyLabel(undefined, currencies)}${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [salesInvoiceId, setSalesInvoiceId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/sales-invoices?limit=100").then((r) => r.json()).then((d) => setInvoices(d.salesInvoices ?? [])).catch(() => {});
  }, []);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const creditTotal = lines.reduce((sum, l) => sum + num(l.quantity) * num(l.rate), 0);

  const missing = [
    ...(invoices.find((i) => i.id === salesInvoiceId) ? [] : ["Invoice"]),
    ...(lines.every((l) => l.description.trim()) ? [] : ["A description on every line"]),
    ...(lines.every((l) => l.quantity) ? [] : ["A quantity on every line"]),
    ...(lines.every((l) => l.rate) ? [] : ["An amount on every line"]),
  ];

  async function create() {
    const invoice = invoices.find((i) => i.id === salesInvoiceId);
    if (!invoice || missing.length) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/credit-notes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: invoice.customerId, salesInvoiceId: invoice.id, postingDate: new Date().toISOString().slice(0, 10),
          reason: reason || undefined,
          items: lines.map((l) => ({ description: l.description, quantity: num(l.quantity), rate: num(l.rate) })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't create credit note");
      toast.success("Credit note created");
      router.push(`/invoices/credit-notes/${body.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create credit note");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Sales Credit Note</h1>
        <p className="text-sm text-ct-muted mt-1">Invoices / New Credit Note</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Credit Note Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Against Invoice</Label>
            <Select value={salesInvoiceId} onValueChange={setSalesInvoiceId}>
              <SelectTrigger><SelectValue placeholder={invoices.length ? "Select an invoice" : "No invoices found"} /></SelectTrigger>
              <SelectContent>{invoices.map((i) => <SelectItem key={i.id} value={i.id}>#{i.invoiceNumber} — {i.customerName ?? "—"}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Scope reduction, Milestone 2" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Line Items</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, blankLine()])}>
                <Plus className="size-3.5 mr-1" />Add Line
              </Button>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="flex-1" />
                <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-16" />
                <Input placeholder="Amount" type="number" value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} className="w-24" />
                <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Trash2 className="size-4 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-ct-border p-2 text-sm">
            Credit total ({lines.length} {lines.length === 1 ? "line" : "lines"}) — {money(creditTotal)}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/invoices?tab=credit-notes")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={create}
          disabled={submitting || missing.length > 0}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Creating..." : "Create Credit Note"}
        </Button>
      </div>
    </div>
  );
}
