"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge, module 23/24 (payroll): new payroll run screen.
// Ported from PROJEXA's own PayrollRunCreateClient.tsx, rebuilt on this
// repo's own house convention for a "new" screen (Card + Select/Input, see
// src/app/(app)/moms/new/page.tsx) instead of PROJEXA's own ObjectScreen
// archetype from @fchecklist/veridian-ui-kit.
//
// POSTs to /api/v1/projexa/payroll/runs (erp-payroll-service.ts's
// createPayrollRun) -- requires month (1-12) + year; refuses with 409 if a
// run already exists for that month/year (a real DB unique constraint backs
// the app-level check, see that function's own header comment).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function PayrollRunNewPage() {
  const router = useRouter();
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [submitting, setSubmitting] = useState(false);

  async function createRun() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/payroll/runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: Number(month), year: Number(year) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't create payroll run");
      toast.success("Payroll run created");
      router.push(`/payroll/runs/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create payroll run");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Payroll Run</h1>
        <p className="text-sm text-ct-muted mt-1">Payroll / New Run</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Run details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Month</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Year</Label>
            <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/payroll")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
          onClick={() => void createRun()}
          disabled={submitting}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}
