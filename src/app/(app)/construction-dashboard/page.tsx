"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 6 batch 2 (compliance-tracker/PROJEXA merge, module-mapping report
// finding GAP-CONSTR): org-wide construction dashboard -- total projects/
// budget/revenue/expenses, per-project drill-down, department filter.
// Backend (construction-dashboard-service.ts's getOrgDashboard(), Wave 121)
// fully built. Named "construction-dashboard" rather than "dashboard" --
// this repo already has a generic GRC-wide /dashboard page (confirmed via
// `ls src/app/(app)/dashboard`) which is a different concept entirely
// (compliance posture, not construction project financials); PROJEXA's own
// /dashboard is actually its designated home route with a HomeGreeting
// widget this repo has no equivalent of, so this page is a straight port
// of the data cards + project table only, not the greeting chrome.
//
// Department filter is a real addition over PROJEXA's own reference page
// (PROJEXA's DashboardPage never wired the departmentId query param the
// backend already supports into any UI control) -- sourced from the
// existing GET /api/departments the rest of this repo already uses (e.g.
// HR pages), not a new endpoint. getOrgDashboard's own comment documents
// that "department" here is approximated via each project's lead user's
// department (projects has no direct departmentId column) -- surfaced
// as-is via a note under the filter rather than presented as exact.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Building2, Wallet, TrendingUp, Receipt, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type OrgDashboard = {
  totalProjects: number; totalBudget: number; totalRevenue: number; totalExpenses: number;
  projects: { id: string; name: string; revenue: number; expenses: number; taskCount: number; delayedTaskCount: number }[];
};
type Department = { id: string; name: string };

export default function ConstructionDashboardPage() {
  const currencies = useCurrencies();
  const money = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const [data, setData] = useState<OrgDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState("all");

  useEffect(() => {
    fetch("/api/departments")
      .then((r) => r.json())
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => {
        // Non-fatal -- the department filter just shows "All Departments" only.
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (departmentId !== "all") params.set("departmentId", departmentId);
      const res = await fetch(`/api/v1/projexa/dashboard${params.toString() ? `?${params.toString()}` : ""}`);
      const result = await res.json();
      setData(result);
    } catch {
      toast.error("Failed to load construction dashboard");
    } finally {
      setLoading(false);
    }
  }, [departmentId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Construction Dashboard</h1>
          <p className="text-sm text-ct-muted mt-1">Org-wide project financials -- budget, revenue, expenses and delayed-task counts across all active construction projects.</p>
        </div>
        {departments.length > 0 && (
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      {departmentId !== "all" && (
        <p className="text-xs text-ct-muted">Department filter is approximated via each project's lead user's department (projects have no direct department field).</p>
      )}

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : !data ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">Couldn't load the dashboard.</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-4 flex items-center justify-between">
                <div><p className="text-xs text-ct-muted">Active Projects</p><p className="text-2xl font-heading text-ct-navy">{data.totalProjects}</p></div>
                <Building2 className="size-6 text-ct-saffron" />
              </CardContent>
            </Card>
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-4 flex items-center justify-between">
                <div><p className="text-xs text-ct-muted">Total Budget</p><p className="text-2xl font-heading text-ct-navy">{money(data.totalBudget)}</p></div>
                <Wallet className="size-6 text-ct-saffron" />
              </CardContent>
            </Card>
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-4 flex items-center justify-between">
                <div><p className="text-xs text-ct-muted">Total Revenue</p><p className="text-2xl font-heading text-green-700">{money(data.totalRevenue)}</p></div>
                <TrendingUp className="size-6 text-green-700" />
              </CardContent>
            </Card>
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-4 flex items-center justify-between">
                <div><p className="text-xs text-ct-muted">Total Expenses</p><p className="text-2xl font-heading text-ct-navy">{money(data.totalExpenses)}</p></div>
                <Receipt className="size-6 text-ct-saffron" />
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Projects</CardTitle></CardHeader>
            <CardContent className="p-0">
              {data.projects.length === 0 ? (
                <p className="py-10 text-center text-sm text-ct-muted">No active projects yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead><TableHead>Revenue</TableHead><TableHead>Expenses</TableHead>
                      <TableHead>Tasks</TableHead><TableHead>Delayed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.projects.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium text-ct-navy">{p.name}</TableCell>
                        <TableCell>{money(p.revenue)}</TableCell>
                        <TableCell>{money(p.expenses)}</TableCell>
                        <TableCell>{p.taskCount}</TableCell>
                        <TableCell>
                          {p.delayedTaskCount > 0 ? (
                            <span className="inline-flex items-center gap-1 text-red-600">
                              <AlertTriangle className="size-3.5" /> {p.delayedTaskCount}
                            </span>
                          ) : (
                            <span className="text-ct-muted">0</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
