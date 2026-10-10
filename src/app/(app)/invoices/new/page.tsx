"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own InvoiceCreateClient.tsx -- a repeatable line-item editor
// (description/qty/rate, add/remove a row, last row not removable) with a
// running subtotal, matching PROJEXA's own R80 GAP-7 fix (a sales invoice
// must support more than one line). POSTs to the SAME
// POST /api/v1/projexa/sales-invoices this app's backend already serves
// (createSalesInvoice in erp-invoicing-service.ts) -- zero new backend
// route. Tax is applied server-side from each line's tax template on save,
// matching PROJEXA's own screen note.
//
// The customer picker's "+ New customer..." option POSTs to the SAME
// POST /api/v1/projexa/customers this app's backend already serves
// (createCustomer in erp-selling-service.ts), matching PROJEXA's own
// screen's inline-create convenience.
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

type Customer = { id: string; customerName: string };
type Line = { description: string; quantity: string; rate: string };
const NEW_CUSTOMER = "__new__";

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function blankLine(): Line {
  return { description: "", quantity: "1", rate: "" };
}

export default function InvoiceNewPage() {
  const router = useRouter();
  const currencies = useCurrencies();
  const money = (v: number) => `${currencyLabel(undefined, currencies)}${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/customers").then((r) => r.json()).then((d) => setCustomers(d.customers ?? [])).catch(() => {});
  }, []);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const subtotal = lines.reduce((sum, l) => sum + num(l.quantity) * num(l.rate), 0);

  const missing = [
    ...(customerId ? [] : ["Customer"]),
    ...(customerId === NEW_CUSTOMER && !newCustomerName.trim() ? ["New customer name"] : []),
    ...(lines.every((l) => l.description.trim()) ? [] : ["A description on every line"]),
    ...(lines.every((l) => l.quantity) ? [] : ["A quantity on every line"]),
    ...(lines.every((l) => l.rate) ? [] : ["A rate on every line"]),
  ];

  async function create() {
    if (missing.length) return;
    setSubmitting(true);
    try {
      let resolvedCustomerId = customerId;
      if (customerId === NEW_CUSTOMER) {
        const res = await fetch("/api/v1/projexa/customers", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerName: newCustomerName }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? "Couldn't create the new customer");
        resolvedCustomerId = body.id;
      }
      const res = await fetch("/api/v1/projexa/sales-invoices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: resolvedCustomerId, postingDate,
          items: lines.map((l) => ({ description: l.description, quantity: num(l.quantity), rate: num(l.rate) })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't create invoice");
      toast.success("Invoice created");
      router.push(`/invoices/${body.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create invoice");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Sales Invoice</h1>
        <p className="text-sm text-ct-muted mt-1">Invoices / New Invoice</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Invoice Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="Select a customer" /></SelectTrigger>
              <SelectContent>
                {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}
                <SelectItem value={NEW_CUSTOMER}>+ New customer…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {customerId === NEW_CUSTOMER && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">New Customer Name</Label>
              <Input value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Posting Date</Label>
            <Input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
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
                <Input placeholder="Rate" type="number" value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} className="w-24" />
                <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Trash2 className="size-4 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-ct-border p-2 text-sm">
            Subtotal ({lines.length} {lines.length === 1 ? "line" : "lines"}) — {money(subtotal)}
            <p className="text-xs text-ct-muted">Tax is applied from each line&apos;s tax template on save.</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/invoices?tab=invoices")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={create}
          disabled={submitting || missing.length > 0}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Creating..." : "Create Invoice"}
        </Button>
      </div>
    </div>
  );
}
