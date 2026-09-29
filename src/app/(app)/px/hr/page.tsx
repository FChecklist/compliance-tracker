"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of the auth
// middleware's redirect).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), HR module: a
// faithful UI port of PROJEXA's own HR Dashboard (FChecklist/projexa
// src/app/(app)/hr/page.tsx + src/components/HrDashboardClient.tsx) into
// compliance-tracker as a native page, calling the same already-native
// backend PROJEXA calls over HTTP today -- zero new backend logic, UI-only
// port.
//
// Lives at /px/hr, NOT /hr: this repo already has its own, DIFFERENT /hr
// (a statutory-compliance HR directory backed by src/app/api/hr/** +
// hr-dashboard-service.ts) -- a different product concept under the same
// name, not the same feature under two URLs. src/proxy.ts is the piece that
// rewrites projexa-ai.com/hr to this path for PROJEXA's own visitors.
//
// Backend: /api/v1/projexa/employees, /hr/departments, /leave/requests,
// /recruitment/job-openings, /payroll/runs -- the exact routes PROJEXA's
// own src/app/api/{employees,hr,leave,recruitment,payroll}/*/route.ts
// proxy to via callVeridian() today (verified field-for-field against each
// route.ts and its underlying service: hr-service.ts's listEmployees/
// listLeaveRequests, the hr/departments route's own departments query,
// recruitment-service.ts's listJobOpenings, erp-payroll-service.ts's
// listPayrollRuns). Same-origin fetch, real signed-in session --
// requireAuthOrApiKey() falls through to ordinary cookie-session auth
// whenever a request carries no Bearer key, exactly like every other
// session-authenticated page in this app.
//
// UI rebuilt in this repo's own component vocabulary (DashboardCard,
// Card/Badge from @/components/ui/*, ct-navy/ct-muted/ct-saffron classes --
// matching src/app/(app)/construction-dashboard/page.tsx and
// src/app/(app)/permits/page.tsx) rather than PROJEXA's own
// @fchecklist/veridian-ui-kit ScreenFrame/ListScreen. Data and behaviour
// (including surfacing the real backend error on a failed load, rather than
// silently rendering an empty dashboard -- see fetch-json.ts's own header
// comment in the PROJEXA repo for why that distinction matters) are ported
// verbatim.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { DashboardCard } from "@/components/ui/dashboard-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, Briefcase, CalendarClock, Wallet, Building2 } from "lucide-react";

type Employee = { id: string; departmentId: string | null };
type Department = { id: string; name: string };
type LeaveRequest = { id: string; status: string };
type JobOpening = { id: string; status: string };
type PayrollRun = { id: string; month: number; year: number; status: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function PxHrDashboardPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const responses = await Promise.all([
          fetch("/api/v1/projexa/employees"),
          fetch("/api/v1/projexa/hr/departments"),
          fetch("/api/v1/projexa/leave/requests"),
          fetch("/api/v1/projexa/recruitment/job-openings"),
          fetch("/api/v1/projexa/payroll/runs"),
        ]);
        const bodies = await Promise.all(responses.map((r) => r.json().catch(() => null)));
        // Faithful port of PROJEXA's fetchJson(): a non-2xx response must
        // never be silently read as an empty list (its own header comment,
        // src/lib/fetch-json.ts, documents this as a real, previously-shipped
        // bug -- R48_HTTP_ERROR_SWALLOWED_AS_EMPTY_LIST_01). Show the real
        // backend message rather than inventing one, or a blank dashboard.
        const failedIndex = responses.findIndex((r) => !r.ok);
        if (failedIndex !== -1) {
          const failedBody = bodies[failedIndex] as { error?: string } | null;
          throw new Error(failedBody?.error ?? `Request failed (HTTP ${responses[failedIndex].status})`);
        }
        const [empData, deptData, leaveData, openData, runsData] = bodies as [
          { employees?: Employee[] } | null,
          { departments?: Department[] } | null,
          { requests?: LeaveRequest[] } | null,
          { jobOpenings?: JobOpening[] } | null,
          { runs?: PayrollRun[] } | null,
        ];
        setEmployees(empData?.employees ?? []);
        setDepartments(deptData?.departments ?? []);
        setLeaveRequests(leaveData?.requests ?? []);
        setOpenings(openData?.jobOpenings ?? []);
        setRuns(runsData?.runs ?? []);
      } catch (err) {
        toast.error(
          err instanceof Error && err.message
            ? `Couldn't load HR dashboard: ${err.message}`
            : "Couldn't load HR dashboard"
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const pendingLeave = useMemo(
    () => leaveRequests.filter((r) => r.status === "pending").length,
    [leaveRequests]
  );
  const openPositions = useMemo(() => openings.filter((o) => o.status === "open"), [openings]);
  const draftRun = useMemo(() => runs.find((r) => r.status === "draft"), [runs]);
  const headcountByDept = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of employees) {
      const key = e.departmentId ?? "__none__";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([id, count]) => ({
        id,
        name: id === "__none__" ? "Unassigned" : departments.find((d) => d.id === id)?.name ?? "Unknown",
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [employees, departments]);

  if (loading) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-ct-muted" />
      </div>
    );
  }

  const maxDeptCount = Math.max(1, ...headcountByDept.map((d) => d.count));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">HR Dashboard</h1>
        <p className="text-sm text-ct-muted mt-1">
          Headcount, open positions, pending leave and the next payroll run, across every department.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardCard
          title="Total Headcount"
          value={employees.length}
          icon={Users}
          variant="total"
          subtitle={`${departments.length} department(s)`}
        />
        <DashboardCard
          title="Open Positions"
          value={openPositions.length}
          icon={Briefcase}
          variant="pending"
          subtitle="across active job openings"
        />
        <DashboardCard
          title="Pending Leave Approvals"
          value={pendingLeave}
          icon={CalendarClock}
          variant={pendingLeave > 0 ? "overdue" : "completed"}
          subtitle="awaiting a decision"
        />
        <DashboardCard
          title="Upcoming Payroll Run"
          value={draftRun ? `${MONTHS[draftRun.month - 1]} ${draftRun.year}` : "None"}
          icon={Wallet}
          variant={draftRun ? "pending" : "completed"}
          subtitle={draftRun ? "draft -- not yet processed" : "no draft run open"}
        />
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-ct-navy">
            <Building2 className="size-4" /> Headcount by Department
          </CardTitle>
        </CardHeader>
        <CardContent>
          {headcountByDept.length === 0 ? (
            <p className="py-6 text-center text-sm text-ct-muted">No employees yet.</p>
          ) : (
            <div className="space-y-2">
              {headcountByDept.map((d) => (
                <div key={d.id} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-sm text-ct-navy">{d.name}</span>
                  <div className="h-2 flex-1 rounded-full bg-ct-cloud">
                    <div
                      className="h-2 rounded-full bg-ct-saffron"
                      style={{ width: `${Math.max(4, (d.count / maxDeptCount) * 100)}%` }}
                    />
                  </div>
                  <Badge variant="outline">{d.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Employees module (ai-os/PROJEXA_SERVER_MERGE_PLAN.md) landed as a
            plain top-level /employees page, not /px/employees -- unlike this
            page's own /hr collision, compliance-tracker had no pre-existing
            /employees route to shadow-route around (confirmed before that
            module's own page.tsx was written), so it lives at the same path
            PROJEXA itself uses. This link previously pointed at a
            placeholder /px/employees in anticipation of that module. */}
        <Link href="/employees" className="block">
          <Card className="rounded-xl shadow-card bg-white transition-shadow hover:shadow-md">
            <CardContent className="p-4">
              <p className="font-medium text-ct-navy">Employee Directory</p>
              <p className="text-sm text-ct-muted">Departments, org chart, leave</p>
            </CardContent>
          </Card>
        </Link>
        {/* Already native: /erp/payroll (src/app/(app)/erp/payroll/page.tsx)
            reads/writes the same erp-payroll-service.ts backend the
            /api/v1/projexa/payroll/** routes alias -- one feature, linked
            there rather than to a new /px/payroll page. */}
        <Link href="/erp/payroll" className="block">
          <Card className="rounded-xl shadow-card bg-white transition-shadow hover:shadow-md">
            <CardContent className="p-4">
              <p className="font-medium text-ct-navy">Payroll</p>
              <p className="text-sm text-ct-muted">Runs, structures, statutory rules</p>
            </CardContent>
          </Card>
        </Link>
        {/* Already native: /recruitment (src/app/(app)/recruitment/page.tsx)
            reads/writes the same recruitment-service.ts backend the
            /api/v1/projexa/recruitment/** routes alias. */}
        <Link href="/recruitment" className="block">
          <Card className="rounded-xl shadow-card bg-white transition-shadow hover:shadow-md">
            <CardContent className="p-4">
              <p className="font-medium text-ct-navy">Recruitment</p>
              <p className="text-sm text-ct-muted">Openings, candidates, pipeline</p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
