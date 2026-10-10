"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own QuotationCreateClient.tsx. POSTs to the SAME
// POST /api/v1/projexa/procurement/quotations this app's backend already
// serves (createSupplierQuotation in erp-procurement-workflow-service.ts) --
// a SUPPLIER quotation received in response to an RFQ, distinct from this
// repo's customer-facing /quotations module (a different table, a different
// direction of the deal -- see that route's own header comment).
//
// No Object Page for this resource -- no getSupplierQuotation() exists
// upstream (only listSupplierQuotations), matching PROJEXA's own screen
// exactly. "Convert to PO" stays a real inline action on the Procurement
// overview's Quotations tab.
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

type Rfq = { id: string; rfqNumber: number };
type Vendor = { id: string; vendorName: string };
type Line = { description: string; quantity: string; rate: string };

const NO_RFQ = "__none__";

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function blankLine(): Line {
  return { description: "", quantity: "1", rate: "" };
}

export default function QuotationNewPage() {
  const router = useRouter();
  const currencies = useCurrencies();
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [rfqId, setRfqId] = useState(NO_RFQ);
  const [supplierId, setSupplierId] = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validTill, setValidTill] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/procurement/rfqs").then((r) => r.json()).then((d) => setRfqs(d.rfqs ?? [])).catch(() => {});
    fetch("/api/v1/projexa/vendors").then((r) => r.json()).then((d) => setVendors(d.vendors ?? [])).catch(() => {});
  }, []);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const quotedTotal = lines.reduce((sum, l) => sum + num(l.quantity) * num(l.rate), 0);

  const missing = [
    ...(supplierId ? [] : ["Vendor"]),
    ...(lines.every((l) => l.description.trim()) ? [] : ["A description on every line"]),
    ...(lines.every((l) => l.quantity) ? [] : ["A quantity on every line"]),
  ];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/procurement/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rfqId: rfqId !== NO_RFQ ? rfqId : undefined,
          supplierId,
          postingDate,
          validTill: validTill || undefined,
          items: lines.map((l) => ({ description: l.description, quantity: num(l.quantity), rate: num(l.rate) })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't record quotation");
      toast.success("Quotation recorded");
      router.push("/procurement?tab=quotations");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record quotation");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Record Supplier Quotation</h1>
        <p className="text-sm text-ct-muted mt-1">Procurement / Record Quotation</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Quotation Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">RFQ (optional)</Label>
            <Select value={rfqId} onValueChange={setRfqId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_RFQ}>None</SelectItem>
                {rfqs.map((r) => <SelectItem key={r.id} value={r.id}>RFQ-{r.rfqNumber}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Vendor</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder={vendors.length ? "Select vendor" : "No vendors found"} /></SelectTrigger>
              <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Posting Date</Label>
              <Input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Valid Till (optional)</Label>
              <Input type="date" value={validTill} onChange={(e) => setValidTill(e.target.value)} />
            </div>
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
                <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-20" />
                <Input placeholder="Rate" type="number" value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} className="w-28" />
                <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Trash2 className="size-4 text-red-500" />
                </Button>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-ct-border p-2 text-sm text-ct-navy">
            Quoted total ({lines.length} {lines.length === 1 ? "line" : "lines"}) — {currencyLabel(undefined, currencies)}{quotedTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/procurement?tab=quotations")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={create}
          disabled={submitting || missing.length > 0}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Recording..." : "Record Quotation"}
        </Button>
      </div>
    </div>
  );
}
