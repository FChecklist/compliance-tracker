"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge, module 23/24 (payroll): new salary component
// screen. Ported from PROJEXA's own SalaryComponentCreateClient.tsx,
// rebuilt on this repo's own house convention (Card + Input/Select, see
// src/app/(app)/moms/new/page.tsx) instead of PROJEXA's own ObjectScreen.
// No Object Page -- no getSalaryComponent()/updateSalaryComponent() exists
// in erp-payroll-service.ts.
//
// POSTs to /api/v1/projexa/payroll/salary-components
// (erp-payroll-service.ts's createSalaryComponent) -- requires name +
// componentType; calculationType defaults to "flat" server-side if
// omitted, kept explicit here for clarity.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function SalaryComponentNewPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [componentType, setComponentType] = useState<"earning" | "deduction">("earning");
  const [calculationType, setCalculationType] = useState("flat");
  const [defaultAmount, setDefaultAmount] = useState("");
  const [defaultPercentage, setDefaultPercentage] = useState("");
  const [includeInPfWage, setIncludeInPfWage] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function create() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/payroll/salary-components", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, componentType, calculationType,
          defaultAmount: defaultAmount ? Number(defaultAmount) : undefined,
          defaultPercentage: defaultPercentage ? Number(defaultPercentage) : undefined,
          includeInPfWage,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't create salary component");
      toast.success("Salary component created");
      router.push("/payroll?tab=components");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create salary component");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Salary Component</h1>
        <p className="text-sm text-ct-muted mt-1">Payroll / New Salary Component</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Component details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HRA" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Type</Label>
              <Select value={componentType} onValueChange={(v) => setComponentType(v as "earning" | "deduction")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="earning">Earning</SelectItem>
                  <SelectItem value="deduction">Deduction</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Calculation</Label>
              <Select value={calculationType} onValueChange={setCalculationType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Flat</SelectItem>
                  <SelectItem value="percentage_of_basic">% of Basic</SelectItem>
                  <SelectItem value="percentage_of_gross">% of Gross</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Default Amount</Label><Input type="number" value={defaultAmount} onChange={(e) => setDefaultAmount(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Default %</Label><Input type="number" value={defaultPercentage} onChange={(e) => setDefaultPercentage(e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ct-navy">
            <input type="checkbox" checked={includeInPfWage} onChange={(e) => setIncludeInPfWage(e.target.checked)} />
            Include in PF wage
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/payroll?tab=components")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
          onClick={() => void create()}
          disabled={submitting || !name.trim()}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}
