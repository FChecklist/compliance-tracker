"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge, module 23/24 (payroll): new salary structure
// screen. Ported from PROJEXA's own SalaryStructureCreateClient.tsx,
// rebuilt on this repo's own house convention (Card + Input/Select, see
// src/app/(app)/moms/new/page.tsx) instead of PROJEXA's own ObjectScreen.
// No Object Page -- no getSalaryStructure()/updateSalaryStructure() exists
// in erp-payroll-service.ts.
//
// IMPORTANT FIELD-NAME GOTCHA (confirmed against the live schema, not
// assumed from PROJEXA's own client, per the porting brief's own warning):
// erp-payroll-service.ts's createSalaryStructure validates its
// `employeeId` input against employeeProfiles.id (schema.ts:
// erpSalaryStructures.employeeId references employeeProfiles.id) -- NOT
// against users.id. GET /api/v1/projexa/employees returns each employee's
// top-level `id` as users.id, with a nested `profile` (employeeProfiles
// row, or null if that user has no HR profile yet). So the Employee select
// below is filtered to employees with a profile and posts `e.profile.id`,
// not `e.id` -- same convention this repo's own pre-existing
// src/app/(app)/erp/payroll/page.tsx already uses
// (`employeesWithProfile.map((e) => <SelectItem value={e.profile!.id}>`).
// PROJEXA's own reference client got this wrong for ITS OWN backend (which
// evidently treats employees[].id as directly usable) -- that assumption
// does not carry over to this repo's real backend and was not copied here.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Employee = { id: string; name: string | null; email: string; profile: { id: string; employeeCode: string | null } | null };
type SalaryComponent = { id: string; name: string };

export default function SalaryStructureNewPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [employeeProfileId, setEmployeeProfileId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [ctcAnnual, setCtcAnnual] = useState("");
  const [state, setState] = useState("");
  const [rows, setRows] = useState<{ componentId: string; amount: string; percentage: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/employees").then((r) => r.json()).then((d) => setEmployees(d.employees ?? [])).catch(() => {});
    fetch("/api/v1/projexa/payroll/salary-components").then((r) => r.json()).then((d) => setComponents(d.components ?? [])).catch(() => {});
  }, []);

  const employeesWithProfile = useMemo(() => employees.filter((e) => e.profile), [employees]);

  function addRow() { setRows((r) => [...r, { componentId: "", amount: "", percentage: "" }]); }
  function removeRow(i: number) { setRows((r) => r.filter((_, idx) => idx !== i)); }

  const missing = [
    ...(employeeProfileId ? [] : ["Employee"]),
    ...(effectiveFrom ? [] : ["Effective date"]),
    ...(ctcAnnual ? [] : ["Annual CTC"]),
    ...(rows.length ? [] : ["At least one component"]),
  ];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/payroll/salary-structures", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: employeeProfileId, effectiveFrom, ctcAnnual: Number(ctcAnnual), state: state || undefined,
          components: rows.filter((r) => r.componentId).map((r) => ({
            componentId: r.componentId, amount: r.amount ? Number(r.amount) : undefined, percentage: r.percentage ? Number(r.percentage) : undefined,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't create salary structure");
      toast.success("Salary structure created");
      router.push("/payroll?tab=structures");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create salary structure");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Salary Structure</h1>
        <p className="text-sm text-ct-muted mt-1">Payroll / New Salary Structure</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Structure details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Employee</Label>
            <Select value={employeeProfileId} onValueChange={setEmployeeProfileId}>
              <SelectTrigger><SelectValue placeholder="Select employee (must have an HR profile)" /></SelectTrigger>
              <SelectContent>
                {employeesWithProfile.map((e) => (
                  <SelectItem key={e.profile!.id} value={e.profile!.id}>
                    {e.name ?? e.email} {e.profile?.employeeCode ? `(${e.profile.employeeCode})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {employees.length > 0 && employeesWithProfile.length === 0 && (
              <p className="text-xs text-ct-muted">No employees have an HR profile yet -- create one from /employees/new first.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Effective From</Label><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Annual CTC</Label><Input type="number" value={ctcAnnual} onChange={(e) => setCtcAnnual(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">State (optional, for Professional Tax)</Label>
            <Input value={state} onChange={(e) => setState(e.target.value)} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Components</Label>
              <Button size="sm" variant="outline" onClick={addRow}><Plus className="size-3" /> Add</Button>
            </div>
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={row.componentId} onValueChange={(v) => setRows((r) => r.map((x, idx) => idx === i ? { ...x, componentId: v } : x))}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Component" /></SelectTrigger>
                  <SelectContent>{components.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="w-24" placeholder="Amount" type="number" value={row.amount} onChange={(e) => setRows((r) => r.map((x, idx) => idx === i ? { ...x, amount: e.target.value } : x))} />
                <Input className="w-20" placeholder="%" type="number" value={row.percentage} onChange={(e) => setRows((r) => r.map((x, idx) => idx === i ? { ...x, percentage: e.target.value } : x))} />
                <Button size="icon" variant="ghost" onClick={() => removeRow(i)}><Trash2 className="size-4" /></Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/payroll?tab=structures")} disabled={submitting}>Cancel</Button>
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
