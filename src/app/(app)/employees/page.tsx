"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own Employees module (src/app/(app)/employees/page.tsx +
// EmployeesClient.tsx there -- 4 tabs: Directory, Departments, Org Chart,
// Leave). Reads the already-native /api/v1/projexa/employees,
// /hr/departments, /hr/org-chart, /leave/requests, /leave/balances,
// /companies -- zero new backend route, zero HTTP hop to a separate origin
// (verified field-for-field against each route.ts and hr-service.ts before
// writing this file).
//
// This is a genuinely new top-level page: unlike the 7 already-ported
// `px/<name>` shadow modules (px/hr, px/recruitment, ...), compliance-tracker
// has no pre-existing /employees route to collide with, so this lives at
// /employees directly rather than /px/employees -- confirmed via a repo-wide
// check before writing this file. px/hr/page.tsx's own "Employee Directory"
// card previously pointed at a placeholder /px/employees in anticipation of
// this module; it is repointed at /employees in this same PR.
//
// UI is compliance-tracker's own shadcn Tabs/Table/Card/Select (matching the
// house convention every already-ported PROJEXA-merge page uses: see
// src/app/(app)/vendors/page.tsx, src/app/(app)/budgets/page.tsx), not
// PROJEXA's @fchecklist/veridian-ui-kit ScreenFrame/DataTable, and real
// create routes (new/, departments/new/, leave/new/, leave/balance/new/)
// rather than Dialog popups -- matching PROJEXA's own 2026-08-30
// "real-screen conversion" of this exact module.
//
// Two deliberate simplifications from PROJEXA's own reference page:
//  1. PROJEXA's CompanySelector (with a "consolidate" toggle) has no
//     equivalent anywhere in this repo yet -- the simpler company-filter
//     <Select> pattern src/app/(app)/budgets/page.tsx already uses is
//     reused here instead, on the Directory tab only (Leave's own company
//     scoping is a real, minor, UI-only gap -- see the Leave tab's own
//     comment below).
//  2. No client-side isHrAdmin gate: PROJEXA's useOrgRole() hook has no
//     equivalent in this repo (confirmed via a repo-wide search, same
//     finding src/app/(app)/vendors/page.tsx's own header comment already
//     recorded for its isIndiaOrg gate) -- every write action renders
//     unconditionally and the real server-side requireRoleOrScope() gate on
//     each route (manager/write for create/decide, member/write for a leave
//     request) is the actual authorization boundary, same as every other
//     already-ported PROJEXA-merge page.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Check, X, Users, Building2, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type EmployeeProfile = {
  employeeCode: string | null;
  jobTitle: string | null;
  employmentType: string | null;
  dateOfJoining: string | null;
  employmentStatus: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  companyId: string | null;
};
type Employee = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  departmentId: string | null;
  reportingToId: string | null;
  profile: EmployeeProfile | null;
};
type Department = { id: string; name: string; description: string | null; headName: string | null; memberCount: number };
type OrgChart = { employees: Employee[]; roots: Employee[]; byManager: Record<string, Employee[]> };
type LeaveRequest = {
  id: string; userId: string; leaveType: string; startDate: string; endDate: string;
  numDays: string; reason: string | null; status: string; companyId: string | null;
};
type LeaveBalance = { id: string; userId: string; leaveType: string; year: number; totalDays: string; usedDays: string };
type Company = { id: string; companyName: string; abbr: string | null };

const EMPLOYMENT_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default", on_leave: "secondary", terminated: "destructive", resigned: "outline",
};
const LEAVE_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default", pending: "secondary", rejected: "destructive",
};
const ALL_DEPARTMENTS = "__all__";
const ALL_COMPANIES = "__all__";
const VALID_TABS = new Set(["directory", "departments", "orgchart", "leave"]);

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

async function fetchOk<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Couldn't load ${what} (HTTP ${res.status})`);
  return body as T;
}

function EmployeesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [activeTab, setActiveTabState] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "directory");

  function setActiveTab(next: string) {
    setActiveTabState(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [orgChart, setOrgChart] = useState<OrgChart | null>(null);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  // One entry per endpoint that did not answer -- matches PROJEXA's own
  // EmployeesClient.tsx precedent (its R52/R48_EMPLOYEES_PAGE_CLIENT_CRASH_01
  // header comment): partial data is shown alongside an honest banner naming
  // what didn't load, rather than a blank tab or a silent empty list.
  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  const [deptFilter, setDeptFilter] = useState(ALL_DEPARTMENTS);
  const [companyFilter, setCompanyFilter] = useState(ALL_COMPANIES);
  const [leaveStatusFilter, setLeaveStatusFilter] = useState("pending");
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [empRes, deptRes, chartRes, leaveRes, balRes, coRes] = await Promise.allSettled([
      fetchOk<{ employees?: Employee[] }>("/api/v1/projexa/employees", "employees"),
      fetchOk<{ departments?: Department[] }>("/api/v1/projexa/hr/departments", "departments"),
      fetchOk<OrgChart>("/api/v1/projexa/hr/org-chart", "org chart"),
      fetchOk<{ requests?: LeaveRequest[] }>("/api/v1/projexa/leave/requests", "leave requests"),
      fetchOk<{ balances?: LeaveBalance[] }>("/api/v1/projexa/leave/balances", "leave balances"),
      fetchOk<{ companies?: Company[] }>("/api/v1/projexa/companies", "companies"),
    ]);

    const failures: string[] = [];
    function value<T>(result: PromiseSettledResult<T>, label: string): T | null {
      if (result.status === "fulfilled") return result.value;
      failures.push(result.reason instanceof Error ? result.reason.message : `Couldn't load ${label}`);
      return null;
    }

    setEmployees(value(empRes, "employees")?.employees ?? []);
    setDepartments(value(deptRes, "departments")?.departments ?? []);
    const chart = value(chartRes, "org chart");
    setOrgChart(chart && Array.isArray(chart.roots) && chart.byManager ? chart : null);
    setLeaveRequests(value(leaveRes, "leave requests")?.requests ?? []);
    setLeaveBalances(value(balRes, "leave balances")?.balances ?? []);
    setCompanies(value(coRes, "companies")?.companies ?? []);

    setLoadErrors(failures);
    if (failures.length > 0) toast.error(failures[0]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, decision: "approved" | "rejected") {
    setDecidingId(id);
    try {
      const res = await fetch(`/api/v1/projexa/leave/requests/${id}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't update leave request");
      toast.success(`Leave request ${decision}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update leave request");
    } finally {
      setDecidingId(null);
    }
  }

  async function approveAllPending() {
    const pending = leaveRequests.filter((r) => r.status === "pending");
    if (pending.length === 0) return;
    setBulkApproving(true);
    let succeeded = 0;
    for (const r of pending) {
      try {
        const res = await fetch(`/api/v1/projexa/leave/requests/${r.id}/decision`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "approved" }),
        });
        if (res.ok) succeeded++;
      } catch {
        // continue with remaining requests
      }
    }
    toast.success(`Approved ${succeeded} of ${pending.length} pending leave request(s)`);
    setBulkApproving(false);
    await load();
  }

  const employeeName = (id: string | null) => {
    const e = employees.find((emp) => emp.id === id);
    return e?.name ?? e?.email ?? "—";
  };
  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";

  const filteredEmployees = useMemo(
    () => employees
      .filter((e) => deptFilter === ALL_DEPARTMENTS || e.departmentId === deptFilter)
      .filter((e) => companyFilter === ALL_COMPANIES || e.profile?.companyId === companyFilter),
    [employees, deptFilter, companyFilter]
  );

  const filteredLeaveRequests = useMemo(
    () => (leaveStatusFilter === "all" ? leaveRequests : leaveRequests.filter((r) => r.status === leaveStatusFilter)),
    [leaveRequests, leaveStatusFilter]
  );

  function OrgNode({ node, depth }: { node: Employee; depth: number }) {
    const children = orgChart?.byManager[node.id] ?? [];
    return (
      <div style={{ marginLeft: depth * 20 }} className="border-l border-ct-border pl-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-ct-navy">{node.name ?? node.email}</span>
          {node.profile?.jobTitle && <span className="text-xs text-ct-muted">— {node.profile.jobTitle}</span>}
          <Badge variant="outline" className="text-[10px]">{departmentName(node.departmentId)}</Badge>
        </div>
        {children.map((c) => <OrgNode key={c.id} node={c} depth={depth + 1} />)}
      </div>
    );
  }

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-ct-muted" /></div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Employees</h1>
        <p className="text-sm text-ct-muted mt-1">Directory, departments, reporting hierarchy and leave -- for company employees, not site labour (see /labour for that).</p>
      </div>

      {loadErrors.length > 0 && (
        <Card role="alert" className="rounded-xl border-ct-error bg-red-50">
          <CardContent className="space-y-2 p-4 text-sm text-ct-error">
            <p className="font-medium">Some HR data could not be loaded. What is shown below is incomplete.</p>
            <ul className="list-disc space-y-0.5 pl-5">{loadErrors.map((m) => <li key={m}>{m}</li>)}</ul>
            <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="directory"><Users className="size-4 mr-1" /> Directory</TabsTrigger>
          <TabsTrigger value="departments"><Building2 className="size-4 mr-1" /> Departments</TabsTrigger>
          <TabsTrigger value="orgchart"><Network className="size-4 mr-1" /> Org Chart</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
        </TabsList>

        <TabsContent value="directory" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Select value={deptFilter} onValueChange={setDeptFilter}>
                <SelectTrigger className="w-52"><SelectValue placeholder="All departments" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_DEPARTMENTS}>All departments</SelectItem>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {companies.length > 0 && (
                <Select value={companyFilter} onValueChange={setCompanyFilter}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_COMPANIES}>All companies</SelectItem>
                    {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => router.push("/employees/new")}>
              <Plus className="size-4 mr-1" /> Employee Profile
            </Button>
          </div>

          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              {filteredEmployees.length === 0 ? (
                <p className="py-10 text-center text-sm text-ct-muted">No employees yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Department</TableHead>
                      <TableHead>Designation</TableHead><TableHead>Reports To</TableHead><TableHead>Employment Type</TableHead>
                      <TableHead>Emp. Code</TableHead><TableHead>Joined</TableHead><TableHead>Status</TableHead><TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEmployees.map((e) => (
                      <TableRow key={e.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/employees/${e.id}`)}>
                        <TableCell className="font-medium text-ct-navy">{e.name ?? "—"}</TableCell>
                        <TableCell className="text-ct-muted">{e.email}</TableCell>
                        <TableCell className="text-ct-muted">{departmentName(e.departmentId)}</TableCell>
                        <TableCell className="text-ct-muted">{e.profile?.jobTitle ?? "—"}</TableCell>
                        <TableCell className="text-ct-muted">{employeeName(e.reportingToId)}</TableCell>
                        <TableCell>{e.profile?.employmentType ? <Badge variant="outline">{e.profile.employmentType.replace(/_/g, " ")}</Badge> : "—"}</TableCell>
                        <TableCell className="text-ct-muted">{e.profile?.employeeCode ?? "—"}</TableCell>
                        <TableCell className="text-ct-muted">{e.profile?.dateOfJoining ? formatDate(e.profile.dateOfJoining) : "—"}</TableCell>
                        <TableCell>
                          {e.profile?.employmentStatus ? (
                            <Badge variant={EMPLOYMENT_STATUS_VARIANT[e.profile.employmentStatus] ?? "outline"}>
                              {e.profile.employmentStatus.replace(/_/g, " ")}
                            </Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={(evt) => { evt.stopPropagation(); router.push(`/employees/${e.id}`); }}>View</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="departments" className="space-y-4">
          <div className="flex justify-end">
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => router.push("/employees/departments/new")}>
              <Plus className="size-4 mr-1" /> New Department
            </Button>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              {departments.length === 0 ? (
                <p className="py-10 text-center text-sm text-ct-muted">No departments yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead>Head</TableHead><TableHead>Members</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {departments.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium text-ct-navy">{d.name}</TableCell>
                        <TableCell className="text-ct-muted">{d.description ?? "—"}</TableCell>
                        <TableCell className="text-ct-muted">{d.headName ?? "—"}</TableCell>
                        <TableCell className="text-ct-muted">{d.memberCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orgchart" className="space-y-4">
          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Reporting Hierarchy</CardTitle></CardHeader>
            <CardContent>
              {!orgChart || orgChart.roots.length === 0 ? (
                <p className="py-10 text-center text-sm text-ct-muted">No reporting hierarchy set up yet.</p>
              ) : (
                <div className="space-y-1">{orgChart.roots.map((r) => <OrgNode key={r.id} node={r} depth={0} />)}</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Company scoping (PROJEXA's own CompanySelector) is not ported onto
            this tab -- a real, minor, UI-only gap: /leave/requests and
            /leave/balances both support the underlying filters
            (companyId/userId query params), just not wired to a selector
            here. Revisit if a real multi-company org needs it; every other
            already-ported PROJEXA-merge page with a company concept (see
            ../budgets/page.tsx) filters on one screen at a time too. */}
        <TabsContent value="leave" className="space-y-6">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-ct-navy">Leave Requests</h3>
                <Select value={leaveStatusFilter} onValueChange={setLeaveStatusFilter}>
                  <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm"
                  disabled={bulkApproving || leaveRequests.filter((r) => r.status === "pending").length === 0}
                  onClick={() => void approveAllPending()}
                >
                  {bulkApproving ? "Approving…" : "Approve All Pending"}
                </Button>
                <Button size="sm" onClick={() => router.push("/employees/leave/new")}><Plus className="size-4 mr-1" /> Request Leave</Button>
              </div>
            </div>

            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                {filteredLeaveRequests.length === 0 ? (
                  <p className="py-10 text-center text-sm text-ct-muted">No leave requests.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Dates</TableHead><TableHead>Days</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLeaveRequests.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium text-ct-navy">{employeeName(r.userId)}</TableCell>
                          <TableCell className="text-ct-muted">{r.leaveType}</TableCell>
                          <TableCell className="text-ct-muted">{formatDate(r.startDate)} – {formatDate(r.endDate)}</TableCell>
                          <TableCell>{r.numDays}</TableCell>
                          <TableCell><Badge variant={LEAVE_STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
                          <TableCell>
                            {r.status === "pending" && (
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" disabled={decidingId === r.id} onClick={() => void decide(r.id, "approved")}><Check className="size-4 text-ct-success" /></Button>
                                <Button size="icon" variant="ghost" disabled={decidingId === r.id} onClick={() => void decide(r.id, "rejected")}><X className="size-4 text-ct-error" /></Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ct-navy">Leave Balances</h3>
              <Button size="sm" variant="outline" onClick={() => router.push("/employees/leave/balance/new")}><Plus className="size-4 mr-1" /> Set Balance</Button>
            </div>
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                {leaveBalances.length === 0 ? (
                  <p className="py-10 text-center text-sm text-ct-muted">No leave balances set yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Year</TableHead><TableHead>Total</TableHead><TableHead>Used</TableHead><TableHead>Remaining</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {leaveBalances.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="font-medium text-ct-navy">{employeeName(b.userId)}</TableCell>
                          <TableCell className="text-ct-muted">{b.leaveType}</TableCell>
                          <TableCell className="text-ct-muted">{b.year}</TableCell>
                          <TableCell>{b.totalDays}</TableCell>
                          <TableCell>{b.usedDays}</TableCell>
                          <TableCell>{(Number(b.totalDays) - Number(b.usedDays)).toFixed(1)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function EmployeesPage() {
  return (
    <Suspense fallback={<div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-ct-muted" /></div>}>
      <EmployeesPageInner />
    </Suspense>
  );
}
