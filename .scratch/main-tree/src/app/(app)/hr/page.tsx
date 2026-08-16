"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 40 (VERIDIAN HR, PLATFORM_STRATEGY.md §19): Employee Directory, Org
// Chart (zero-schema, derived from users.reportingToId/departmentId), and
// Leave Requests -- closing the gap from statutory-compliance-only HR to
// an actual employee master + leave workflow.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Users, Network, CalendarDays, Check, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

type Employee = {
  id: string; name: string; email: string; role: string; departmentId: string | null; reportingToId: string | null;
  profile: { employeeCode: string | null; jobTitle: string | null; employmentType: string; dateOfJoining: string | null } | null;
};

type LeaveRequest = {
  id: string; userId: string; leaveType: string; startDate: string; endDate: string; numDays: string; status: string; reason: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-ct-saffron/20 text-ct-saffron",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-ct-cloud text-ct-muted",
};

export default function HrPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const [empRes, reqRes, meRes] = await Promise.all([
      fetch("/api/hr/employees"), fetch("/api/hr/leave-requests"), fetch("/api/me"),
    ]);
    const [empData, reqData, meData] = await Promise.all([empRes.json(), reqRes.json(), meRes.json()]);
    setEmployees(empData.employees ?? []);
    setRequests(reqData.requests ?? []);
    setMyRole(meData.role ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isManager = myRole === "manager" || myRole === "admin";

  const employeesByName = new Map(employees.map((e) => [e.id, e.name]));

  const createLeaveRequest = async () => {
    if (!leaveType.trim() || !startDate || !endDate) return;
    setCreating(true);
    try {
      const res = await fetch("/api/hr/leave-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaveType, startDate, endDate, reason: reason || undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Leave requested");
      setOpen(false);
      setLeaveType(""); setStartDate(""); setEndDate(""); setReason("");
      load();
    } catch {
      toast.error("Failed to request leave");
    } finally {
      setCreating(false);
    }
  };

  const decide = async (requestId: string, decision: "approved" | "rejected") => {
    try {
      const res = await fetch(`/api/hr/leave-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Failed to decide request");
    }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">HR</h1>
        <p className="text-sm text-ct-muted mt-1">Employee directory, org chart, and leave requests -- distinct from the statutory HR compliance tracking under People &amp; HR.</p>
      </div>

      <Tabs defaultValue="directory">
        <TabsList>
          <TabsTrigger value="directory"><Users className="size-3.5 mr-1.5" /> Directory</TabsTrigger>
          <TabsTrigger value="orgchart"><Network className="size-3.5 mr-1.5" /> Org Chart</TabsTrigger>
          <TabsTrigger value="leave"><CalendarDays className="size-3.5 mr-1.5" /> Leave</TabsTrigger>
        </TabsList>

        <TabsContent value="directory" className="mt-4">
          <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
            {employees.map((emp) => (
              <div key={emp.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ct-navy">{emp.name}</p>
                  <p className="text-xs text-ct-muted">
                    {emp.profile?.jobTitle || emp.role} &middot; {emp.email}
                    {emp.profile?.employeeCode ? ` · ${emp.profile.employeeCode}` : ""}
                    {emp.profile?.dateOfJoining ? ` · joined ${new Date(emp.profile.dateOfJoining).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <Badge variant="secondary" className="text-xs">{emp.profile?.employmentType?.replace("_", " ") || "full time"}</Badge>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="orgchart" className="mt-4">
          <div className="space-y-2">
            {employees.filter((e) => !e.reportingToId).map((root) => (
              <OrgNode key={root.id} employee={root} employees={employees} depth={0} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="leave" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">Request Leave</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Request Leave</DialogTitle>
                  <DialogDescription>Goes to your manager for approval.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Leave Type</Label>
                    <Input value={leaveType} onChange={(e) => setLeaveType(e.target.value)} placeholder="Casual Leave" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-ct-muted uppercase">Start</Label>
                      <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-ct-muted uppercase">End</Label>
                      <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Reason (optional)</Label>
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={createLeaveRequest} disabled={creating || !leaveType.trim() || !startDate || !endDate} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                    {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                    Submit
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {requests.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No leave requests yet.</CardContent>
            </Card>
          ) : (
            <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
              {requests.map((req) => (
                <div key={req.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ct-navy">
                      {employeesByName.get(req.userId) || "Employee"} &middot; {req.leaveType}
                    </p>
                    <p className="text-xs text-ct-muted">
                      {new Date(req.startDate).toLocaleDateString()} - {new Date(req.endDate).toLocaleDateString()} ({req.numDays} days)
                      {req.reason ? ` · ${req.reason}` : ""}
                    </p>
                  </div>
                  <Badge className={`text-xs border-0 ${STATUS_COLORS[req.status] ?? "bg-ct-cloud text-ct-muted"}`}>{req.status}</Badge>
                  {isManager && req.status === "pending" && (
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => decide(req.id, "approved")}><Check className="size-4 text-ct-teal" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => decide(req.id, "rejected")}><X className="size-4 text-ct-error" /></Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OrgNode({ employee, employees, depth }: { employee: Employee; employees: Employee[]; depth: number }) {
  const reports = employees.filter((e) => e.reportingToId === employee.id);
  return (
    <div style={{ marginLeft: depth * 24 }}>
      <div className="flex items-center gap-2 py-1.5">
        <div className="size-2 rounded-full bg-ct-teal shrink-0" />
        <span className="text-sm font-medium text-ct-navy">{employee.name}</span>
        <span className="text-xs text-ct-muted">{employee.profile?.jobTitle || employee.role}</span>
      </div>
      {reports.map((r) => <OrgNode key={r.id} employee={r} employees={employees} depth={depth + 1} />)}
    </div>
  );
}
