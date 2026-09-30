"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge, module 23/24 (payroll): new income tax slab
// screen. Ported from PROJEXA's own IncomeTaxSlabCreateClient.tsx, rebuilt
// on this repo's own house convention (Card + Input, see
// src/app/(app)/moms/new/page.tsx) instead of PROJEXA's own ObjectScreen.
// No Object Page -- no getIncomeTaxSlab()/updateIncomeTaxSlab() exists in
// erp-payroll-service.ts.
//
// POSTs to /api/v1/projexa/payroll/income-tax-slabs
// (erp-payroll-service.ts's createIncomeTaxSlab) -- requires name +
// effectiveFrom + at least one rate band { fromAmount, toAmount?,
// percentDeduction }. Old regime vs. new regime is two separate slab
// records here, not a flag.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function IncomeTaxSlabNewPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [standardDeduction, setStandardDeduction] = useState("");
  const [rateRows, setRateRows] = useState<{ fromAmount: string; toAmount: string; percentDeduction: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function addRow() { setRateRows((r) => [...r, { fromAmount: "", toAmount: "", percentDeduction: "" }]); }
  function removeRow(i: number) { setRateRows((r) => r.filter((_, idx) => idx !== i)); }

  const missing = [...(name.trim() ? [] : ["Name"]), ...(effectiveFrom ? [] : ["Effective date"]), ...(rateRows.length ? [] : ["At least one rate band"])];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/payroll/income-tax-slabs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, effectiveFrom, standardDeduction: standardDeduction ? Number(standardDeduction) : undefined,
          rates: rateRows.filter((r) => r.fromAmount && r.percentDeduction).map((r) => ({
            fromAmount: Number(r.fromAmount), toAmount: r.toAmount ? Number(r.toAmount) : undefined, percentDeduction: Number(r.percentDeduction),
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't create income tax slab");
      toast.success("Income tax slab created");
      router.push("/payroll?tab=tax");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create income tax slab");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Income Tax Slab</h1>
        <p className="text-sm text-ct-muted mt-1">Payroll / New Income Tax Slab</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Slab details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New Regime FY26-27" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Effective From</Label><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Standard Deduction</Label>
            <Input type="number" value={standardDeduction} onChange={(e) => setStandardDeduction(e.target.value)} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Rate Bands</Label>
              <Button size="sm" variant="outline" onClick={addRow}><Plus className="size-3" /> Add</Button>
            </div>
            {rateRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input placeholder="From" type="number" value={row.fromAmount} onChange={(e) => setRateRows((r) => r.map((x, idx) => idx === i ? { ...x, fromAmount: e.target.value } : x))} />
                <Input placeholder="To (blank = no cap)" type="number" value={row.toAmount} onChange={(e) => setRateRows((r) => r.map((x, idx) => idx === i ? { ...x, toAmount: e.target.value } : x))} />
                <Input placeholder="Rate %" type="number" value={row.percentDeduction} onChange={(e) => setRateRows((r) => r.map((x, idx) => idx === i ? { ...x, percentDeduction: e.target.value } : x))} />
                <Button size="icon" variant="ghost" onClick={() => removeRow(i)}><Trash2 className="size-4" /></Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/payroll?tab=tax")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
          onClick={() => void create()}
          disabled={submitting || missing.length > 0}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}
