"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own RequisitionCreateClient.tsx. POSTs to the SAME
// POST /api/v1/projexa/procurement/requisitions this app's backend already
// serves (createPurchaseRequisition in erp-procurement-workflow-service.ts),
// which requires at least one line item (description + quantity, no rate --
// a requisition carries no money, only the RFQ that follows it does).
//
// Rebuilt on this repo's own Card/Input/Textarea (matching
// src/app/(app)/purchase-orders/new/page.tsx), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Line = { description: string; quantity: string };

function blankLine(): Line {
  return { description: "", quantity: "1" };
}

export default function RequisitionNewPage() {
  const router = useRouter();
  const [purpose, setPurpose] = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [submitting, setSubmitting] = useState(false);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const missing = lines.every((l) => l.description.trim()) ? [] : ["A description on every line"];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/procurement/requisitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: purpose || undefined,
          postingDate,
          items: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 1 })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't create requisition");
      toast.success("Requisition created");
      router.push(`/procurement/requisitions/${body.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create requisition");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Purchase Requisition</h1>
        <p className="text-sm text-ct-muted mt-1">Procurement / New Requisition</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Requisition Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Purpose (optional)</Label>
            <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Why is this needed?" />
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
                <Input placeholder="Description — e.g. TMT bars 12mm" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="flex-1" />
                <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-24" />
                <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Trash2 className="size-4 text-red-500" />
                </Button>
              </div>
            ))}
            <p className="text-xs text-ct-muted">No rate here — a requisition asks for what is needed; the RFQ and quotation that follow it carry price.</p>
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
          {submitting ? "Creating..." : "Create Requisition"}
        </Button>
      </div>
    </div>
  );
}
