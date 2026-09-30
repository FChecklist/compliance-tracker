"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge, module 23/24 (payroll): new statutory rule screen.
// Ported from PROJEXA's own StatutoryRuleCreateClient.tsx, rebuilt on this
// repo's own house convention (Card + Input/Select, see
// src/app/(app)/moms/new/page.tsx) instead of PROJEXA's own ObjectScreen.
// No Object Page -- no getStatutoryRule()/updateStatutoryRule() exists in
// erp-payroll-service.ts, matching every other create-only master-data
// screen in this same module (components, tax slabs).
//
// POSTs to /api/v1/projexa/payroll/statutory-rules
// (erp-payroll-service.ts's createStatutoryRule). state is required only
// for ruleType "professional_tax" (server-enforced); slabs (an array of
// { uptoAmount, taxAmount }) is only meaningful for professional_tax --
// pf/esi instead use employeeRate/employerRate/wageCeiling.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function StatutoryRuleNewPage() {
  const router = useRouter();
  const [ruleType, setRuleType] = useState<"pf" | "esi" | "professional_tax">("pf");
  const [state, setState] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [employeeRate, setEmployeeRate] = useState("");
  const [employerRate, setEmployerRate] = useState("");
  const [wageCeiling, setWageCeiling] = useState("");
  const [slabRows, setSlabRows] = useState<{ uptoAmount: string; taxAmount: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function addSlabRow() { setSlabRows((r) => [...r, { uptoAmount: "", taxAmount: "" }]); }
  function removeSlabRow(i: number) { setSlabRows((r) => r.filter((_, idx) => idx !== i)); }

  const missing = [
    ...(effectiveFrom ? [] : ["Effective date"]),
    ...(ruleType === "professional_tax" && !state.trim() ? ["State"] : []),
  ];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/payroll/statutory-rules", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleType, state: state || undefined, effectiveFrom,
          employeeRate: employeeRate ? Number(employeeRate) : undefined,
          employerRate: employerRate ? Number(employerRate) : undefined,
          wageCeiling: wageCeiling ? Number(wageCeiling) : undefined,
          slabs: ruleType === "professional_tax" && slabRows.length
            ? slabRows.filter((r) => r.uptoAmount && r.taxAmount).map((r) => ({ uptoAmount: Number(r.uptoAmount), taxAmount: Number(r.taxAmount) }))
            : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't create statutory rule");
      toast.success("Statutory rule created");
      router.push("/payroll?tab=statutory");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create statutory rule");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Statutory Rule</h1>
        <p className="text-sm text-ct-muted mt-1">Payroll / New Statutory Rule</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Rule details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Rule Type</Label>
              <Select value={ruleType} onValueChange={(v) => setRuleType(v as typeof ruleType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pf">Provident Fund</SelectItem>
                  <SelectItem value="esi">ESI</SelectItem>
                  <SelectItem value="professional_tax">Professional Tax</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Effective From</Label>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
          </div>

          {ruleType === "professional_tax" ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">State</Label>
                <Input value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. Maharashtra" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Slabs (up to amount → tax amount)</Label>
                  <Button size="sm" variant="outline" onClick={addSlabRow}><Plus className="size-3" /> Add</Button>
                </div>
                {slabRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input placeholder="Upto amount" type="number" value={row.uptoAmount} onChange={(e) => setSlabRows((r) => r.map((x, idx) => idx === i ? { ...x, uptoAmount: e.target.value } : x))} />
                    <Input placeholder="Tax amount" type="number" value={row.taxAmount} onChange={(e) => setSlabRows((r) => r.map((x, idx) => idx === i ? { ...x, taxAmount: e.target.value } : x))} />
                    <Button size="icon" variant="ghost" onClick={() => removeSlabRow(i)}><Trash2 className="size-4" /></Button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Employee Rate %</Label><Input type="number" value={employeeRate} onChange={(e) => setEmployeeRate(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Employer Rate %</Label><Input type="number" value={employerRate} onChange={(e) => setEmployerRate(e.target.value)} /></div>
              <div className="col-span-2 space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Wage Ceiling</Label><Input type="number" value={wageCeiling} onChange={(e) => setWageCeiling(e.target.value)} /></div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/payroll?tab=statutory")} disabled={submitting}>Cancel</Button>
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
