"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own RfqCreateClient.tsx. POSTs to the SAME
// POST /api/v1/projexa/procurement/rfqs this app's backend already serves
// (createRfq in erp-procurement-workflow-service.ts), which requires at
// least one line item and at least one invited vendor; the linked
// requisition is optional (an RFQ can be raised directly).
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

type Requisition = { id: string; requisitionNumber: number };
type Vendor = { id: string; vendorName: string };
type Line = { description: string; quantity: string };

const NO_REQUISITION = "__none__";

function blankLine(): Line {
  return { description: "", quantity: "1" };
}

export default function RfqNewPage() {
  const router = useRouter();
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [requisitionId, setRequisitionId] = useState(NO_REQUISITION);
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/procurement/requisitions").then((r) => r.json()).then((d) => setRequisitions(d.requisitions ?? [])).catch(() => {});
    fetch("/api/v1/projexa/vendors").then((r) => r.json()).then((d) => setVendors(d.vendors ?? [])).catch(() => {});
  }, []);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const missing = [
    ...(lines.every((l) => l.description.trim()) ? [] : ["A description on every line"]),
    ...(supplierIds.length ? [] : ["At least one vendor"]),
  ];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/procurement/rfqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requisitionId: requisitionId !== NO_REQUISITION ? requisitionId : undefined,
          postingDate,
          items: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 1 })),
          supplierIds,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't create RFQ");
      toast.success("RFQ created");
      router.push(`/procurement/rfqs/${body.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create RFQ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Request for Quotation</h1>
        <p className="text-sm text-ct-muted mt-1">Procurement / New RFQ</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">RFQ Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Linked Requisition (optional)</Label>
            <Select value={requisitionId} onValueChange={setRequisitionId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_REQUISITION}>None — raise directly</SelectItem>
                {requisitions.map((r) => <SelectItem key={r.id} value={r.id}>PR-{r.requisitionNumber}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
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
                <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-24" />
                <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Trash2 className="size-4 text-red-500" />
                </Button>
              </div>
            ))}
            <p className="text-xs text-ct-muted">No rate here — an RFQ asks suppliers for prices; the supplier quotations that follow it carry price.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Vendors to invite</Label>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-ct-border p-2">
              {vendors.map((v) => (
                <label key={v.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={supplierIds.includes(v.id)}
                    onChange={(e) => setSupplierIds((prev) => (e.target.checked ? [...prev, v.id] : prev.filter((id) => id !== v.id)))}
                  />
                  {v.vendorName}
                </label>
              ))}
              {vendors.length === 0 && <p className="text-xs text-ct-muted">No vendors yet — add one on the Vendors page first.</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/procurement")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={create}
          disabled={submitting || missing.length > 0}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Creating..." : "Create RFQ"}
        </Button>
      </div>
    </div>
  );
}
