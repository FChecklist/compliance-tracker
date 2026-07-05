"use client";

export const dynamic = "force-dynamic";

// Wave 56 (VERI ERP gap-fill, Tier 2 #5/#6): Indian Statutory Payroll.
// PF/ESI/Professional Tax are computed by a configurable rule engine (rates
// live in erp_statutory_rules, never hardcoded) -- see
// erp-payroll-service.ts. TDS was originally NOT auto-computed at all.
//
// Wave 68: Income Tax Slabs give payroll TDS a real, admin-editable
// auto-compute engine -- opt-in per employee. An employee with no slab
// assigned keeps the original manual-entry-only behavior.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Employee = { id: string; name: string; profile: { id: string; employeeCode: string | null; incomeTaxSlabId: string | null } | null };
type Component = { id: string; name: string; componentType: string; calculationType: string; defaultPercentage: string | null; defaultAmount: string | null; includeInPfWage: boolean };
type StatutoryRule = { id: string; ruleType: string; state: string | null; effectiveFrom: string; employeeRate: string | null; employerRate: string | null; wageCeiling: string | null; slabs: { uptoAmount: number; taxAmount: number }[] | null };
type Structure = { id: string; employeeId: string; employeeName: string; ctcAnnual: string; effectiveFrom: string; state: string | null };
type PayrollRun = { id: string; month: number; year: number; status: string };
type Payslip = { id: string; employeeId: string; employeeName: string; grossEarnings: string; totalDeductions: string; netPay: string; status: string; lines: { id: string; label: string; lineType: string; amount: string }[] };
type IncomeTaxSlab = { id: string; name: string; effectiveFrom: string; standardDeduction: string; rates: { fromAmount: string; toAmount: string | null; percentDeduction: string }[] };

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function ErpPayrollPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [rules, setRules] = useState<StatutoryRule[]>([]);
  const [structures, setStructures] = useState<Structure[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [compOpen, setCompOpen] = useState(false);
  const [compName, setCompName] = useState("");
  const [compType, setCompType] = useState<"earning" | "deduction">("earning");
  const [compCalc, setCompCalc] = useState<"flat" | "percentage_of_basic" | "percentage_of_gross">("flat");
  const [compIncludeInPf, setCompIncludeInPf] = useState(false);
  const [creatingComp, setCreatingComp] = useState(false);

  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleType, setRuleType] = useState<"pf" | "esi" | "professional_tax">("pf");
  const [ruleState, setRuleState] = useState("");
  const [ruleFrom, setRuleFrom] = useState(new Date().toISOString().slice(0, 10));
  const [ruleEmpRate, setRuleEmpRate] = useState("");
  const [ruleErRate, setRuleErRate] = useState("");
  const [ruleCeiling, setRuleCeiling] = useState("");
  const [ruleNotes, setRuleNotes] = useState("");
  const [creatingRule, setCreatingRule] = useState(false);

  const [structOpen, setStructOpen] = useState(false);
  const [structEmployeeId, setStructEmployeeId] = useState("");
  const [structCtc, setStructCtc] = useState("");
  const [structFrom, setStructFrom] = useState(new Date().toISOString().slice(0, 10));
  const [structState, setStructState] = useState("");
  const [structComponents, setStructComponents] = useState<{ componentId: string; amount: string; percentage: string }[]>([]);
  const [creatingStruct, setCreatingStruct] = useState(false);

  const [runOpen, setRunOpen] = useState(false);
  const [runMonth, setRunMonth] = useState(String(new Date().getMonth() + 1));
  const [runYear, setRunYear] = useState(String(new Date().getFullYear()));
  const [creatingRun, setCreatingRun] = useState(false);

  const [slabs, setSlabs] = useState<IncomeTaxSlab[]>([]);
  const [slabOpen, setSlabOpen] = useState(false);
  const [slabName, setSlabName] = useState("");
  const [slabFrom, setSlabFrom] = useState(new Date().toISOString().slice(0, 10));
  const [slabStdDeduction, setSlabStdDeduction] = useState("");
  const [slabRates, setSlabRates] = useState<{ fromAmount: string; toAmount: string; percentDeduction: string }[]>([{ fromAmount: "0", toAmount: "", percentDeduction: "" }]);
  const [creatingSlab, setCreatingSlab] = useState(false);
  const [assigningSlabFor, setAssigningSlabFor] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/hr/employees").catch(() => null),
      fetch("/api/erp/payroll/salary-components"),
      fetch("/api/erp/payroll/statutory-rules"),
      fetch("/api/erp/payroll/salary-structures"),
      fetch("/api/erp/payroll/runs"),
      fetch("/api/erp/payroll/income-tax-slabs"),
    ])
      .then(([empRes, compRes, ruleRes, structRes, runRes, slabRes]) => Promise.all([
        empRes && empRes.ok ? empRes.json() : { employees: [] },
        compRes.json(), ruleRes.json(), structRes.json(), runRes.json(), slabRes.json(),
      ]))
      .then(([empData, compData, ruleData, structData, runData, slabData]) => {
        setEmployees(empData.employees ?? []);
        setComponents(compData.components ?? []);
        setRules(ruleData.rules ?? []);
        setStructures(structData.structures ?? []);
        setRuns(runData.runs ?? []);
        setSlabs(slabData.slabs ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const loadPayslips = useCallback((runId: string) => {
    Promise.resolve().then(() => {
      if (!runId) { setPayslips([]); return undefined; }
      return fetch(`/api/erp/payroll/runs/${runId}/payslips`).then((r) => r.json()).then((d) => setPayslips(d.payslips ?? []));
    }).catch(() => setPayslips([]));
  }, []);

  useEffect(() => { loadPayslips(selectedRunId); }, [selectedRunId, loadPayslips]);

  const createComponent = async () => {
    setCreatingComp(true);
    const res = await fetch("/api/erp/payroll/salary-components", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: compName, componentType: compType, calculationType: compCalc, includeInPfWage: compIncludeInPf }),
    });
    setCreatingComp(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create component"); return; }
    setCompOpen(false); setCompName(""); setCompIncludeInPf(false);
    toast.success("Salary component created");
    load();
  };

  const createRule = async () => {
    setCreatingRule(true);
    const res = await fetch("/api/erp/payroll/statutory-rules", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ruleType, state: ruleType === "professional_tax" ? ruleState : undefined, effectiveFrom: ruleFrom,
        employeeRate: ruleEmpRate ? Number(ruleEmpRate) : undefined, employerRate: ruleErRate ? Number(ruleErRate) : undefined,
        wageCeiling: ruleCeiling ? Number(ruleCeiling) : undefined, notes: ruleNotes || undefined,
      }),
    });
    setCreatingRule(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create rule"); return; }
    setRuleOpen(false); setRuleState(""); setRuleEmpRate(""); setRuleErRate(""); setRuleCeiling(""); setRuleNotes("");
    toast.success("Statutory rule saved");
    load();
  };

  const createStructure = async () => {
    setCreatingStruct(true);
    const res = await fetch("/api/erp/payroll/salary-structures", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: structEmployeeId, effectiveFrom: structFrom, ctcAnnual: Number(structCtc) || 0, state: structState || undefined,
        components: structComponents.filter((c) => c.componentId).map((c) => ({ componentId: c.componentId, amount: c.amount ? Number(c.amount) : undefined, percentage: c.percentage ? Number(c.percentage) : undefined })),
      }),
    });
    setCreatingStruct(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create salary structure"); return; }
    setStructOpen(false); setStructCtc(""); setStructComponents([]);
    toast.success("Salary structure created");
    load();
  };

  const createRun = async () => {
    setCreatingRun(true);
    const res = await fetch("/api/erp/payroll/runs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: Number(runMonth), year: Number(runYear) }),
    });
    setCreatingRun(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create payroll run"); return; }
    setRunOpen(false);
    toast.success("Payroll run created as draft");
    load();
  };

  const processRun = async (id: string) => {
    setBusyId(id);
    const res = await fetch(`/api/erp/payroll/runs/${id}/process`, { method: "POST" });
    setBusyId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to process"); return; }
    const d = await res.json();
    toast.success(`Processed ${d.payslipCount} payslip(s)`);
    load();
    if (selectedRunId === id) loadPayslips(id);
  };

  const updateTds = async (payslipId: string, amount: string) => {
    const res = await fetch(`/api/erp/payroll/payslips/${payslipId}/tds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tdsAmount: Number(amount) || 0 }) });
    if (!res.ok) { toast.error("Failed to update TDS"); return; }
    toast.success("TDS updated");
    loadPayslips(selectedRunId);
  };

  const finalizePayslip = async (payslipId: string) => {
    const res = await fetch(`/api/erp/payroll/payslips/${payslipId}/finalize`, { method: "POST" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to finalize"); return; }
    toast.success("Payslip finalized");
    loadPayslips(selectedRunId);
  };

  const createSlab = async () => {
    setCreatingSlab(true);
    const res = await fetch("/api/erp/payroll/income-tax-slabs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: slabName, effectiveFrom: slabFrom, standardDeduction: slabStdDeduction ? Number(slabStdDeduction) : undefined,
        rates: slabRates.filter((r) => r.percentDeduction).map((r) => ({ fromAmount: Number(r.fromAmount) || 0, toAmount: r.toAmount ? Number(r.toAmount) : undefined, percentDeduction: Number(r.percentDeduction) })),
      }),
    });
    setCreatingSlab(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create income tax slab"); return; }
    setSlabOpen(false); setSlabName(""); setSlabStdDeduction(""); setSlabRates([{ fromAmount: "0", toAmount: "", percentDeduction: "" }]);
    toast.success("Income tax slab saved");
    load();
  };

  const assignSlab = async (employeeProfileId: string, slabId: string) => {
    setAssigningSlabFor(employeeProfileId);
    const res = await fetch(`/api/erp/payroll/employees/${employeeProfileId}/income-tax-slab`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slabId: slabId || undefined }),
    });
    setAssigningSlabFor(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to assign slab"); return; }
    toast.success("Income tax slab assigned");
    load();
  };

  const employeesWithProfile = employees.filter((e) => e.profile);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Statutory Payroll</h1>
        <p className="text-sm text-ct-muted mt-1">Salary structures, PF/ESI/Professional Tax (configurable rates, never hardcoded), payroll runs — VERI ERP AI</p>
        <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-2 inline-block">TDS auto-computes only for employees with an Income Tax Slab assigned (see that tab) — always review the amount before finalizing. Employees with no slab assigned still require a manually-entered value.</p>
      </div>

      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">Payroll Runs</TabsTrigger>
          <TabsTrigger value="structures">Salary Structures</TabsTrigger>
          <TabsTrigger value="components">Salary Components</TabsTrigger>
          <TabsTrigger value="rules">Statutory Rules</TabsTrigger>
          <TabsTrigger value="taxslabs">Income Tax Slabs</TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={runOpen} onOpenChange={setRunOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Payroll Run</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Payroll Run</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Month</Label>
                    <Select value={runMonth} onValueChange={setRunMonth}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Year</Label><Input type="number" value={runYear} onChange={(e) => setRunYear(e.target.value)} /></div>
                </div>
                <DialogFooter><Button onClick={createRun} disabled={creatingRun} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingRun && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Create</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Period</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={3} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : runs.length === 0 ? <tr><td colSpan={3} className="p-6 text-center text-ct-muted">No payroll runs yet.</td></tr>
                    : runs.map((r) => (
                      <tr key={r.id} className="hover:bg-ct-row-hover cursor-pointer" onClick={() => setSelectedRunId(r.id)}>
                        <td className="p-3">{MONTHS[r.month - 1]} {r.year}</td>
                        <td className="p-3"><Badge className={r.status === "processed" ? "bg-green-100 text-green-700" : "bg-ct-cloud text-ct-muted"}>{r.status}</Badge></td>
                        <td className="p-3">
                          {r.status === "draft" && <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={(e) => { e.stopPropagation(); processRun(r.id); }} disabled={busyId === r.id}>{busyId === r.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Process</Button>}
                          {r.status === "processed" && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); setSelectedRunId(r.id); }}>View Payslips</Button>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {selectedRunId && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Employee</th><th className="p-3 font-medium text-right">Gross</th><th className="p-3 font-medium text-right">Deductions</th><th className="p-3 font-medium text-right">Net Pay</th><th className="p-3 font-medium">TDS</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
                  <tbody className="divide-y divide-ct-border">
                    {payslips.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-ct-muted">No payslips for this run.</td></tr>
                      : payslips.map((p) => {
                        const tdsLine = p.lines.find((l) => l.label.startsWith("TDS"));
                        return (
                          <tr key={p.id} className="hover:bg-ct-row-hover">
                            <td className="p-3">{p.employeeName}</td>
                            <td className="p-3 text-right">{Number(p.grossEarnings).toFixed(2)}</td>
                            <td className="p-3 text-right">{Number(p.totalDeductions).toFixed(2)}</td>
                            <td className="p-3 text-right font-medium">{Number(p.netPay).toFixed(2)}</td>
                            <td className="p-3">
                              {p.status === "draft" ? (
                                <Input className="w-24 h-7 text-xs" type="number" defaultValue={tdsLine?.amount ?? "0"} onBlur={(e) => updateTds(p.id, e.target.value)} />
                              ) : (Number(tdsLine?.amount ?? 0).toFixed(2))}
                            </td>
                            <td className="p-3"><Badge className={p.status === "finalized" ? "bg-green-100 text-green-700" : "bg-ct-cloud text-ct-muted"}>{p.status}</Badge></td>
                            <td className="p-3">{p.status === "draft" && <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={() => finalizePayslip(p.id)}>Finalize</Button>}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="structures" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={structOpen} onOpenChange={setStructOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Structure</Button></DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader><DialogTitle>New Salary Structure</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Employee</Label>
                    <Select value={structEmployeeId} onValueChange={setStructEmployeeId}>
                      <SelectTrigger><SelectValue placeholder="Select employee (must have an HR profile)" /></SelectTrigger>
                      <SelectContent>{employeesWithProfile.map((e) => <SelectItem key={e.profile!.id} value={e.profile!.id}>{e.name} {e.profile?.employeeCode ? `(${e.profile.employeeCode})` : ""}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Effective From</Label><Input type="date" value={structFrom} onChange={(e) => setStructFrom(e.target.value)} /></div>
                    <div><Label>Annual CTC</Label><Input type="number" value={structCtc} onChange={(e) => setStructCtc(e.target.value)} /></div>
                    <div><Label>State (for PT)</Label><Input value={structState} onChange={(e) => setStructState(e.target.value)} placeholder="e.g. Maharashtra" /></div>
                  </div>
                  <div className="space-y-2">
                    <Label>Components</Label>
                    {structComponents.map((c, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Select value={c.componentId} onValueChange={(v) => setStructComponents((prev) => prev.map((p, idx) => idx === i ? { ...p, componentId: v } : p))}>
                          <SelectTrigger className="flex-1"><SelectValue placeholder="Component" /></SelectTrigger>
                          <SelectContent>{components.map((comp) => <SelectItem key={comp.id} value={comp.id}>{comp.name} ({comp.componentType})</SelectItem>)}</SelectContent>
                        </Select>
                        <Input className="w-24" type="number" placeholder="Amount" value={c.amount} onChange={(e) => setStructComponents((prev) => prev.map((p, idx) => idx === i ? { ...p, amount: e.target.value } : p))} />
                        <Input className="w-24" type="number" placeholder="%" value={c.percentage} onChange={(e) => setStructComponents((prev) => prev.map((p, idx) => idx === i ? { ...p, percentage: e.target.value } : p))} />
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setStructComponents((prev) => [...prev, { componentId: "", amount: "", percentage: "" }])}><Plus className="w-3 h-3 mr-1" />Add component</Button>
                  </div>
                </div>
                <DialogFooter><Button onClick={createStructure} disabled={creatingStruct || !structEmployeeId} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingStruct && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Employee</th><th className="p-3 font-medium">Effective From</th><th className="p-3 font-medium text-right">Annual CTC</th><th className="p-3 font-medium">State</th><th className="p-3 font-medium">Income Tax Slab (TDS)</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={5} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : structures.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-ct-muted">No salary structures yet.</td></tr>
                    : structures.map((s) => {
                      const profile = employeesWithProfile.find((e) => e.profile!.id === s.employeeId)?.profile;
                      return (
                        <tr key={s.id} className="hover:bg-ct-row-hover">
                          <td className="p-3">{s.employeeName}</td><td className="p-3">{s.effectiveFrom}</td><td className="p-3 text-right">{Number(s.ctcAnnual).toFixed(2)}</td><td className="p-3">{s.state ?? "—"}</td>
                          <td className="p-3">
                            <Select value={profile?.incomeTaxSlabId ?? "__none__"} onValueChange={(v) => assignSlab(s.employeeId, v === "__none__" ? "" : v)} disabled={assigningSlabFor === s.employeeId}>
                              <SelectTrigger className="w-44 h-7 text-xs"><SelectValue placeholder="Manual TDS only" /></SelectTrigger>
                              <SelectContent><SelectItem value="__none__">Manual TDS only</SelectItem>{slabs.map((sl) => <SelectItem key={sl.id} value={sl.id}>{sl.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="components" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={compOpen} onOpenChange={setCompOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Component</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Salary Component</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Name</Label><Input value={compName} onChange={(e) => setCompName(e.target.value)} placeholder="e.g. Basic, HRA, Special Allowance" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Type</Label>
                      <Select value={compType} onValueChange={(v) => setCompType(v as "earning" | "deduction")}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="earning">Earning</SelectItem><SelectItem value="deduction">Deduction</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div><Label>Calculation</Label>
                      <Select value={compCalc} onValueChange={(v) => setCompCalc(v as typeof compCalc)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="flat">Flat Amount</SelectItem><SelectItem value="percentage_of_basic">% of Basic</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                  {compType === "earning" && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={compIncludeInPf} onChange={(e) => setCompIncludeInPf(e.target.checked)} />
                      Include in PF wage (typically Basic + DA only)
                    </label>
                  )}
                </div>
                <DialogFooter><Button onClick={createComponent} disabled={creatingComp || !compName} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingComp && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Type</th><th className="p-3 font-medium">Calculation</th><th className="p-3 font-medium">PF Wage</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : components.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">No salary components yet.</td></tr>
                    : components.map((c) => (
                      <tr key={c.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{c.name}</td><td className="p-3">{c.componentType}</td><td className="p-3">{c.calculationType}</td><td className="p-3">{c.includeInPfWage ? "Yes" : "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Statutory Rule</Button></DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader><DialogTitle>New Statutory Rule</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <p className="text-xs text-ct-muted">Rates/ceilings are stored here as editable master data, never hardcoded — verify against the current EPFO/ESIC/state notification before saving.</p>
                  <div><Label>Rule Type</Label>
                    <Select value={ruleType} onValueChange={(v) => setRuleType(v as typeof ruleType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pf">Provident Fund (PF)</SelectItem>
                        <SelectItem value="esi">ESI</SelectItem>
                        <SelectItem value="professional_tax">Professional Tax</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {ruleType === "professional_tax" && <div><Label>State</Label><Input value={ruleState} onChange={(e) => setRuleState(e.target.value)} placeholder="e.g. Maharashtra" /></div>}
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Effective From</Label><Input type="date" value={ruleFrom} onChange={(e) => setRuleFrom(e.target.value)} /></div>
                    <div><Label>Wage Ceiling</Label><Input type="number" value={ruleCeiling} onChange={(e) => setRuleCeiling(e.target.value)} placeholder="e.g. 15000" /></div>
                    <div><Label>Employee Rate %</Label><Input type="number" value={ruleEmpRate} onChange={(e) => setRuleEmpRate(e.target.value)} placeholder="e.g. 12" /></div>
                    <div><Label>Employer Rate %</Label><Input type="number" value={ruleErRate} onChange={(e) => setRuleErRate(e.target.value)} placeholder="e.g. 12" /></div>
                  </div>
                  <div><Label>Notes / Notification Reference</Label><Input value={ruleNotes} onChange={(e) => setRuleNotes(e.target.value)} placeholder="e.g. EPFO circular dated ..." /></div>
                </div>
                <DialogFooter><Button onClick={createRule} disabled={creatingRule} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingRule && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Type</th><th className="p-3 font-medium">State</th><th className="p-3 font-medium">Effective From</th><th className="p-3 font-medium">Employee %</th><th className="p-3 font-medium">Employer %</th><th className="p-3 font-medium">Ceiling</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : rules.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">No statutory rules configured yet.</td></tr>
                    : rules.map((r) => (
                      <tr key={r.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{r.ruleType}</td><td className="p-3">{r.state ?? "—"}</td><td className="p-3">{r.effectiveFrom}</td>
                        <td className="p-3">{r.employeeRate ?? "—"}</td><td className="p-3">{r.employerRate ?? "—"}</td><td className="p-3">{r.wageCeiling ?? "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="taxslabs" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={slabOpen} onOpenChange={setSlabOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Income Tax Slab</Button></DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader><DialogTitle>New Income Tax Slab</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <p className="text-xs text-ct-muted">Model old regime and new regime as two separate slabs -- an employee is assigned one on the Salary Structures tab.</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Name</Label><Input value={slabName} onChange={(e) => setSlabName(e.target.value)} placeholder="e.g. New Regime FY 2026-27" /></div>
                    <div><Label>Effective From</Label><Input type="date" value={slabFrom} onChange={(e) => setSlabFrom(e.target.value)} /></div>
                    <div><Label>Standard Deduction</Label><Input type="number" value={slabStdDeduction} onChange={(e) => setSlabStdDeduction(e.target.value)} placeholder="e.g. 75000" /></div>
                  </div>
                  <div className="space-y-2">
                    <Label>Slab Bands (progressive -- each band taxed only on the portion within it)</Label>
                    {slabRates.map((r, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input className="flex-1" type="number" placeholder="From amount" value={r.fromAmount} onChange={(e) => setSlabRates((prev) => prev.map((p, idx) => idx === i ? { ...p, fromAmount: e.target.value } : p))} />
                        <Input className="flex-1" type="number" placeholder="To amount (blank = no limit)" value={r.toAmount} onChange={(e) => setSlabRates((prev) => prev.map((p, idx) => idx === i ? { ...p, toAmount: e.target.value } : p))} />
                        <Input className="w-24" type="number" placeholder="Rate %" value={r.percentDeduction} onChange={(e) => setSlabRates((prev) => prev.map((p, idx) => idx === i ? { ...p, percentDeduction: e.target.value } : p))} />
                        <Button size="sm" variant="ghost" onClick={() => setSlabRates((prev) => prev.filter((_, idx) => idx !== i))} disabled={slabRates.length <= 1}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setSlabRates((prev) => [...prev, { fromAmount: "", toAmount: "", percentDeduction: "" }])}><Plus className="w-3 h-3 mr-1" />Add band</Button>
                  </div>
                </div>
                <DialogFooter><Button onClick={createSlab} disabled={creatingSlab || !slabName} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingSlab && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Effective From</th><th className="p-3 font-medium text-right">Standard Deduction</th><th className="p-3 font-medium">Bands</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {slabs.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">No income tax slabs configured yet -- TDS remains manual-entry-only until one is created and assigned.</td></tr>
                    : slabs.map((sl) => (
                      <tr key={sl.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{sl.name}</td><td className="p-3">{sl.effectiveFrom}</td><td className="p-3 text-right">{Number(sl.standardDeduction).toFixed(2)}</td>
                        <td className="p-3">{sl.rates.map((r) => `${r.fromAmount}-${r.toAmount ?? "∞"}: ${r.percentDeduction}%`).join(", ")}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
