"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), module 23/24:
// Payroll hub. Ported from PROJEXA's own src/app/(app)/payroll/page.tsx +
// PayrollClient.tsx (5 tabs: Runs, Salary Structures, Salary Components,
// Statutory Rules, Income Tax), rebuilt on this repo's own house pattern
// (single "use client" page, shadcn Tabs/Table/Card/Select, see
// src/app/(app)/employees/page.tsx and src/app/(app)/moms/page.tsx) rather
// than PROJEXA's own @fchecklist/veridian-ui-kit ScreenFrame/DataTable.
//
// PRE-EXISTING OVERLAP, noted honestly rather than silently duplicated:
// compliance-tracker already has a native /erp/payroll page
// (src/app/(app)/erp/payroll/page.tsx) reading/writing this exact same
// erp-payroll-service.ts backend via a Dialog-popup-based admin/ops UI. This
// new /payroll surface is PROJEXA's own multi-page "real-screen conversion"
// UX (separate create routes instead of Dialogs, a Run Object Page, a
// Payslip Object Page) at PROJEXA's own path -- the same "new top-level
// route that duplicates an existing feature's data" precedent already set
// by /employees (which duplicates /px/hr's HR data) elsewhere in this same
// merge series. Both surfaces are left in place; unifying them is out of
// scope for this port.
//
// CONFIRMED BACKEND CONTRACT (read directly from each route.ts under
// src/app/api/v1/projexa/payroll/** and erp-payroll-service.ts, not assumed
// from PROJEXA's own client): list endpoints return { runs }/{ components }/
// { structures }/{ rules }/{ slabs } respectively. processPayrollRun returns
// { run, payslipCount }. GET /api/v1/projexa/employees returns
// { employees }, each with a top-level `id` = users.id and a nested
// `profile` (employeeProfiles row, or null if that user has no HR profile
// yet). erp-payroll-service.ts's createSalaryStructure/assignIncomeTaxSlab
// both validate their `employeeId` input against employeeProfiles.id, NOT
// users.id (schema.ts: erpSalaryStructures.employeeId references
// employeeProfiles.id) -- confirmed against the live schema and against
// erp/payroll/page.tsx's own `employeesWithProfile = employees.filter((e) =>
// e.profile)` + `value={e.profile!.id}` precedent. Every employee picker
// below follows that same filter-then-profile.id convention; an employee
// with no HR profile cannot be assigned a salary structure or a tax slab
// here (same real constraint erp/payroll/page.tsx already lives with).
//
// No client-side isHrAdmin/isIndiaOrg gate: PROJEXA's useOrgRole() hook has
// no equivalent in this repo (confirmed via the same repo-wide search
// src/app/(app)/employees/page.tsx and src/app/(app)/vendors/page.tsx's own
// header comments already recorded) -- every write action renders
// unconditionally and the real server-side requireRoleOrScope(ctx,
// "manager", "write") gate on each mutating route is the actual
// authorization boundary. The "Income Tax" tab (India-specific in PROJEXA,
// gated on isIndiaOrg there) is always shown here, same precedent as
// vendors/page.tsx's GST column.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type PayrollRun = { id: string; month: number; year: number; status: string; processedAt: string | null };
type SalaryComponent = {
  id: string; name: string; componentType: "earning" | "deduction"; calculationType: string;
  defaultPercentage: string | null; defaultAmount: string | null; isStatutory: boolean; includeInPfWage: boolean;
};
type SalaryStructure = {
  id: string; employeeId: string; employeeName: string; employeeCode: string | null; effectiveFrom: string;
  ctcAnnual: string; state: string | null; components: { componentId: string; amount: string | null; percentage: string | null; component: { name: string } }[];
};
type StatutoryRule = {
  id: string; ruleType: string; state: string | null; effectiveFrom: string; effectiveTo: string | null;
  employeeRate: string | null; employerRate: string | null; wageCeiling: string | null; slabs: { uptoAmount: number; taxAmount: number }[] | null;
};
type IncomeTaxSlab = {
  id: string; name: string; effectiveFrom: string; standardDeduction: string;
  rates: { fromAmount: string; toAmount: string | null; percentDeduction: string }[];
};
type Employee = { id: string; name: string | null; email: string; profile: { id: string; employeeCode: string | null } | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const VALID_TABS = new Set(["runs", "structures", "components", "statutory", "tax"]);

async function fetchOk<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Couldn't load ${what} (HTTP ${res.status})`);
  return body as T;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString();
}

function PayrollPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [activeTab, setActiveTabState] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "runs");

  function setActiveTab(next: string) {
    setActiveTabState(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [rules, setRules] = useState<StatutoryRule[]>([]);
  const [slabs, setSlabs] = useState<IncomeTaxSlab[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [assignEmployeeId, setAssignEmployeeId] = useState("");
  const [assignSlabId, setAssignSlabId] = useState("");
  const [assignSubmitting, setAssignSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [runsRes, empRes, compRes, structRes, rulesRes, slabsRes] = await Promise.allSettled([
      fetchOk<{ runs?: PayrollRun[] }>("/api/v1/projexa/payroll/runs", "payroll runs"),
      fetchOk<{ employees?: Employee[] }>("/api/v1/projexa/employees", "employees"),
      fetchOk<{ components?: SalaryComponent[] }>("/api/v1/projexa/payroll/salary-components", "salary components"),
      fetchOk<{ structures?: SalaryStructure[] }>("/api/v1/projexa/payroll/salary-structures", "salary structures"),
      fetchOk<{ rules?: StatutoryRule[] }>("/api/v1/projexa/payroll/statutory-rules", "statutory rules"),
      fetchOk<{ slabs?: IncomeTaxSlab[] }>("/api/v1/projexa/payroll/income-tax-slabs", "income tax slabs"),
    ]);

    const failures: string[] = [];
    function value<T>(result: PromiseSettledResult<T>, label: string): T | null {
      if (result.status === "fulfilled") return result.value;
      failures.push(result.reason instanceof Error ? result.reason.message : `Couldn't load ${label}`);
      return null;
    }

    setRuns(value(runsRes, "payroll runs")?.runs ?? []);
    setEmployees(value(empRes, "employees")?.employees ?? []);
    setComponents(value(compRes, "salary components")?.components ?? []);
    setStructures(value(structRes, "salary structures")?.structures ?? []);
    setRules(value(rulesRes, "statutory rules")?.rules ?? []);
    setSlabs(value(slabsRes, "income tax slabs")?.slabs ?? []);

    setLoadErrors(failures);
    if (failures.length > 0) toast.error(failures[0]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function processRun(id: string) {
    setProcessingId(id);
    try {
      const res = await fetch(`/api/v1/projexa/payroll/runs/${id}/process`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to process payroll run");
      toast.success(`Processed -- ${data.payslipCount ?? 0} payslip(s) generated`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't process payroll run");
    } finally {
      setProcessingId(null);
    }
  }

  async function assignSlab() {
    if (!assignEmployeeId) return;
    setAssignSubmitting(true);
    try {
      const res = await fetch(`/api/v1/projexa/payroll/employees/${assignEmployeeId}/income-tax-slab`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slabId: assignSlabId || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to assign income tax slab");
      toast.success(assignSlabId ? "Income tax slab assigned" : "Income tax slab cleared");
      setAssignEmployeeId(""); setAssignSlabId("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't assign income tax slab");
    } finally {
      setAssignSubmitting(false);
    }
  }

  const employeesWithProfile = useMemo(() => employees.filter((e) => e.profile), [employees]);

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-ct-muted" /></div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Payroll</h1>
        <p className="text-sm text-ct-muted mt-1">Salary structures, PF/ESI/Professional Tax, payroll runs and payslips.</p>
      </div>

      {loadErrors.length > 0 && (
        <Card role="alert" className="rounded-xl border-ct-error bg-red-50">
          <CardContent className="space-y-2 p-4 text-sm text-ct-error">
            <p className="font-medium">Some payroll data could not be loaded. What is shown below is incomplete.</p>
            <ul className="list-disc space-y-0.5 pl-5">{loadErrors.map((m) => <li key={m}>{m}</li>)}</ul>
            <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="runs">Payroll Runs</TabsTrigger>
          <TabsTrigger value="structures">Salary Structures</TabsTrigger>
          <TabsTrigger value="components">Salary Components</TabsTrigger>
          <TabsTrigger value="statutory">Statutory Rules</TabsTrigger>
          <TabsTrigger value="tax">Income Tax</TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="space-y-4">
          <div className="flex justify-end">
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => router.push("/payroll/runs/new")}>
              <Plus className="size-4 mr-1" /> New Payroll Run
            </Button>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              {runs.length === 0 ? (
                <p className="py-10 text-center text-sm text-ct-muted">No payroll runs yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Period</TableHead><TableHead>Status</TableHead><TableHead>Processed</TableHead><TableHead /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((r) => (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/payroll/runs/${r.id}`)}>
                        <TableCell className="font-medium text-ct-navy">{MONTHS[r.month - 1]} {r.year}</TableCell>
                        <TableCell><Badge variant={r.status === "processed" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                        <TableCell className="text-ct-muted">{r.processedAt ? formatDateTime(r.processedAt) : "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {r.status === "draft" && (
                              <Button size="sm" variant="outline" disabled={processingId === r.id} onClick={(e) => { e.stopPropagation(); void processRun(r.id); }}>
                                <PlayCircle className="size-4" /> {processingId === r.id ? "Processing…" : "Process"}
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); router.push(`/payroll/runs/${r.id}`); }}>View Register</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="structures" className="space-y-4">
          <div className="flex justify-end">
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => router.push("/payroll/structures/new")}>
              <Plus className="size-4 mr-1" /> New Salary Structure
            </Button>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              {structures.length === 0 ? (
                <p className="py-10 text-center text-sm text-ct-muted">No salary structures yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Employee</TableHead><TableHead>Effective From</TableHead><TableHead>Annual CTC</TableHead><TableHead>State</TableHead><TableHead>Components</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {structures.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium text-ct-navy">{s.employeeName}</TableCell>
                        <TableCell className="text-ct-muted">{formatDate(s.effectiveFrom)}</TableCell>
                        <TableCell>{Number(s.ctcAnnual).toLocaleString()}</TableCell>
                        <TableCell className="text-ct-muted">{s.state ?? "—"}</TableCell>
                        <TableCell className="text-ct-muted">{s.components.length}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="components" className="space-y-4">
          <div className="flex justify-end">
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => router.push("/payroll/components/new")}>
              <Plus className="size-4 mr-1" /> New Component
            </Button>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              {components.length === 0 ? (
                <p className="py-10 text-center text-sm text-ct-muted">No salary components yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Calculation</TableHead><TableHead>Default</TableHead><TableHead>PF Wage</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {components.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium text-ct-navy">{c.name}</TableCell>
                        <TableCell><Badge variant="outline">{c.componentType}</Badge></TableCell>
                        <TableCell className="text-ct-muted">{c.calculationType.replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-ct-muted">{c.defaultAmount ?? (c.defaultPercentage ? `${c.defaultPercentage}%` : "—")}</TableCell>
                        <TableCell className="text-ct-muted">{c.includeInPfWage ? "Yes" : "No"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="statutory" className="space-y-4">
          <div className="flex justify-end">
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => router.push("/payroll/statutory-rules/new")}>
              <Plus className="size-4 mr-1" /> New Statutory Rule
            </Button>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              {rules.length === 0 ? (
                <p className="py-10 text-center text-sm text-ct-muted">No statutory rules yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Rule</TableHead><TableHead>State</TableHead><TableHead>Effective From</TableHead><TableHead>Employee Rate</TableHead><TableHead>Employer Rate</TableHead><TableHead>Wage Ceiling</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium text-ct-navy">{r.ruleType.replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-ct-muted">{r.state ?? "—"}</TableCell>
                        <TableCell className="text-ct-muted">{formatDate(r.effectiveFrom)}</TableCell>
                        <TableCell>{r.employeeRate ? `${r.employeeRate}%` : (r.slabs ? `${r.slabs.length} slab(s)` : "—")}</TableCell>
                        <TableCell>{r.employerRate ? `${r.employerRate}%` : "—"}</TableCell>
                        <TableCell>{r.wageCeiling ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax" className="space-y-6">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ct-navy">Income Tax Slabs</h3>
              <Button size="sm" className="bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={() => router.push("/payroll/tax-slabs/new")}>
                <Plus className="size-4 mr-1" /> New Slab
              </Button>
            </div>
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                {slabs.length === 0 ? (
                  <p className="py-10 text-center text-sm text-ct-muted">No income tax slabs yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Name</TableHead><TableHead>Effective From</TableHead><TableHead>Standard Deduction</TableHead><TableHead>Rate Bands</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {slabs.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium text-ct-navy">{s.name}</TableCell>
                          <TableCell className="text-ct-muted">{formatDate(s.effectiveFrom)}</TableCell>
                          <TableCell className="text-ct-muted">{s.standardDeduction}</TableCell>
                          <TableCell className="text-ct-muted">{s.rates.length}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ct-navy">Assign Slab to Employee</h3>
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="flex flex-wrap items-end gap-2 p-4">
                <div className="w-56 space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Employee</Label>
                  <Select value={assignEmployeeId} onValueChange={setAssignEmployeeId}>
                    <SelectTrigger><SelectValue placeholder="Select employee (must have an HR profile)" /></SelectTrigger>
                    <SelectContent>
                      {employeesWithProfile.map((e) => (
                        <SelectItem key={e.profile!.id} value={e.profile!.id}>
                          {e.name ?? e.email} {e.profile?.employeeCode ? `(${e.profile.employeeCode})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-56 space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Slab (blank clears)</Label>
                  <Select value={assignSlabId} onValueChange={setAssignSlabId}>
                    <SelectTrigger><SelectValue placeholder="Select slab" /></SelectTrigger>
                    <SelectContent>{slabs.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button onClick={() => void assignSlab()} disabled={assignSubmitting || !assignEmployeeId} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                  {assignSubmitting ? "Saving…" : "Assign"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function PayrollPage() {
  return (
    <Suspense fallback={<div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-ct-muted" /></div>}>
      <PayrollPageInner />
    </Suspense>
  );
}
