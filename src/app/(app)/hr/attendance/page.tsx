"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// VERIDIAN Review Framework remediation, Wave B (2026-07-17): Employee
// Attendance -- org-wide, per-employee, per-day attendance distinct from
// /construction/attendance (PROJEXA site-labour). Four tabs: My Attendance
// (self check-in/out + a month calendar grid), Team (manager bulk-mark for
// a single date), Summary (monthly report across employees), Holidays
// (manager-managed org holiday calendar used by the summary's working-day
// math). Matches src/app/(app)/hr/page.tsx's tab layout and design tokens.
import { useEffect, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Loader2, CalendarCheck, Users2, BarChart3, CalendarDays, LogIn, LogOut, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AttendanceRecord = {
  id: string; userId: string; date: string; status: string;
  checkInAt: string | null; checkOutAt: string | null; hoursWorked: string | null; notes: string | null;
};

type Employee = { id: string; name: string; email: string; departmentId: string | null };
type Department = { id: string; name: string };
type Holiday = { id: string; date: string; name: string };
type MonthlySummary = {
  userId: string; userName: string | null; workingDays: number; present: number; absent: number;
  halfDay: number; onLeave: number; holidayDays: number; weekendDays: number; unmarked: number;
  payableDays: number; attendancePercent: number;
};

const STATUS_COLORS: Record<string, string> = {
  present: "bg-ct-teal/15 text-ct-teal",
  absent: "bg-ct-error/15 text-ct-error",
  half_day: "bg-ct-saffron/20 text-ct-saffron",
  on_leave: "bg-blue-100 text-blue-700",
  holiday: "bg-ct-cloud text-ct-muted",
};

const STATUS_LABELS: Record<string, string> = {
  present: "Present", absent: "Absent", half_day: "Half Day", on_leave: "On Leave", holiday: "Holiday",
};

function pad(n: number) { return String(n).padStart(2, "0"); }
function isoDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export default function HrAttendancePage() {
  const today = useMemo(() => new Date(), []);
  const [myId, setMyId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());

  const [myRecords, setMyRecords] = useState<AttendanceRecord[]>([]);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [checking, setChecking] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teamDate, setTeamDate] = useState(isoDate(today));
  const [teamRecords, setTeamRecords] = useState<AttendanceRecord[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("present");
  const [bulkSaving, setBulkSaving] = useState(false);

  const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
  const [summaryDept, setSummaryDept] = useState<string>("all");

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");

  const isManager = myRole === "manager" || myRole === "admin" || myRole === "veridian_admin" || myRole === "branch_manager";

  const monthStart = `${year}-${pad(month)}-01`;
  const monthEnd = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;

  const loadMe = useCallback(async () => {
    const res = await fetch("/api/me");
    const data = await res.json();
    setMyId(data.id ?? null);
    setMyRole(data.role ?? null);
  }, []);

  const loadMyRecords = useCallback(async () => {
    const res = await fetch(`/api/hr/attendance?startDate=${monthStart}&endDate=${monthEnd}`);
    const data = await res.json();
    const mine: AttendanceRecord[] = (data.records ?? []).filter((r: AttendanceRecord) => r.userId === myId);
    setMyRecords(mine);
    setTodayRecord(mine.find((r) => r.date === isoDate(today)) ?? null);
  }, [monthStart, monthEnd, myId, today]);

  const loadEmployeesAndDepartments = useCallback(async () => {
    const [empRes, deptRes] = await Promise.all([fetch("/api/hr/employees"), fetch("/api/departments")]);
    const [empData, deptData] = await Promise.all([empRes.json(), deptRes.json()]);
    setEmployees((empData.employees ?? []).map((e: { id: string; name: string; email: string; departmentId: string | null }) => ({ id: e.id, name: e.name, email: e.email, departmentId: e.departmentId })));
    setDepartments((deptData.departments ?? []).map((d: { id: string; name: string }) => ({ id: d.id, name: d.name })));
  }, []);

  const loadTeamRecords = useCallback(async () => {
    const res = await fetch(`/api/hr/attendance?startDate=${teamDate}&endDate=${teamDate}`);
    const data = await res.json();
    setTeamRecords(data.records ?? []);
  }, [teamDate]);

  const loadSummaries = useCallback(async () => {
    const deptParam = summaryDept !== "all" ? `&departmentId=${summaryDept}` : "";
    const res = await fetch(`/api/hr/attendance/summary?month=${month}&year=${year}${deptParam}`);
    const data = await res.json();
    setSummaries(data.summaries ?? []);
  }, [month, year, summaryDept]);

  const loadHolidays = useCallback(async () => {
    const res = await fetch(`/api/hr/attendance/holidays?year=${year}`);
    const data = await res.json();
    setHolidays(data.holidays ?? []);
  }, [year]);

  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => {
    if (!myId) return;
    (async () => {
      await Promise.all([loadMyRecords(), loadEmployeesAndDepartments(), loadTeamRecords(), loadSummaries(), loadHolidays()]);
      setLoading(false);
    })();
  }, [myId]); // eslint rightly can't see loadX deps are stable across renders here -- they're only re-created when their own narrower effects below already handle it
  useEffect(() => { if (myId) loadMyRecords(); }, [monthStart, monthEnd, myId, loadMyRecords]);
  useEffect(() => { if (myId) loadTeamRecords(); }, [teamDate, myId, loadTeamRecords]);
  useEffect(() => { if (myId) loadSummaries(); }, [month, year, summaryDept, myId, loadSummaries]);
  useEffect(() => { if (myId) loadHolidays(); }, [year, myId, loadHolidays]);

  const doCheckIn = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/hr/attendance/check-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error();
      toast.success("Checked in");
      await loadMyRecords();
    } catch { toast.error("Failed to check in"); } finally { setChecking(false); }
  };

  const doCheckOut = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/hr/attendance/check-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error); }
      toast.success("Checked out");
      await loadMyRecords();
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : "Failed to check out"); } finally { setChecking(false); }
  };

  const toggleEmployeeSelection = (id: string) => {
    setSelectedEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submitBulkMark = async () => {
    if (selectedEmployees.size === 0) return;
    setBulkSaving(true);
    try {
      const res = await fetch("/api/hr/attendance/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: teamDate, userIds: Array.from(selectedEmployees), status: bulkStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Marked ${selectedEmployees.size} employee(s) as ${STATUS_LABELS[bulkStatus] ?? bulkStatus}`);
      setSelectedEmployees(new Set());
      await loadTeamRecords();
    } catch { toast.error("Failed to bulk-mark attendance"); } finally { setBulkSaving(false); }
  };

  const addHoliday = async () => {
    if (!newHolidayDate || !newHolidayName.trim()) return;
    try {
      const res = await fetch("/api/hr/attendance/holidays", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: newHolidayDate, name: newHolidayName }),
      });
      if (!res.ok) throw new Error();
      toast.success("Holiday added");
      setNewHolidayDate(""); setNewHolidayName("");
      await Promise.all([loadHolidays(), loadSummaries()]);
    } catch { toast.error("Failed to add holiday"); }
  };

  const removeHoliday = async (id: string) => {
    try {
      const res = await fetch(`/api/hr/attendance/holidays/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await Promise.all([loadHolidays(), loadSummaries()]);
    } catch { toast.error("Failed to remove holiday"); }
  };

  const employeesById = new Map(employees.map((e) => [e.id, e]));
  const recordsByEmployeeForTeamDate = new Map(teamRecords.map((r) => [r.userId, r]));

  const calendarDays = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const recordsByDate = new Map(myRecords.map((r) => [r.date, r]));
    return Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      const dateStr = `${year}-${pad(month)}-${pad(d)}`;
      const dow = new Date(`${dateStr}T00:00:00`).getDay();
      const weekend = dow === 0 || dow === 6;
      return { day: d, dateStr, weekend, record: recordsByDate.get(dateStr) ?? null };
    });
  }, [myRecords, month, year]);

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Attendance</h1>
        <p className="text-sm text-ct-muted mt-1">
          Org-wide employee attendance and monthly reporting -- distinct from Construction&apos;s project-scoped site-labour manpower tracking.
        </p>
      </div>

      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine"><CalendarCheck className="size-3.5 mr-1.5" /> My Attendance</TabsTrigger>
          {isManager && <TabsTrigger value="team"><Users2 className="size-3.5 mr-1.5" /> Team</TabsTrigger>}
          <TabsTrigger value="summary"><BarChart3 className="size-3.5 mr-1.5" /> Summary</TabsTrigger>
          {isManager && <TabsTrigger value="holidays"><CalendarDays className="size-3.5 mr-1.5" /> Holidays</TabsTrigger>}
        </TabsList>

        {/* ── My Attendance ─────────────────────────────────────────── */}
        <TabsContent value="mine" className="mt-4 space-y-3">
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="pt-4 pb-4 flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm font-medium text-ct-navy">Today, {today.toLocaleDateString()}</p>
                <p className="text-xs text-ct-muted mt-0.5">
                  {todayRecord?.checkInAt ? `Checked in ${new Date(todayRecord.checkInAt).toLocaleTimeString()}` : "Not checked in yet"}
                  {todayRecord?.checkOutAt ? ` · Checked out ${new Date(todayRecord.checkOutAt).toLocaleTimeString()}` : ""}
                  {todayRecord?.hoursWorked ? ` · ${todayRecord.hoursWorked}h` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={doCheckIn} disabled={checking || !!todayRecord?.checkInAt} className="bg-ct-teal hover:bg-ct-teal/90 text-white">
                  {checking ? <Loader2 className="size-4 mr-2 animate-spin" /> : <LogIn className="size-4 mr-2" />} Check In
                </Button>
                <Button onClick={doCheckOut} disabled={checking || !todayRecord?.checkInAt || !!todayRecord?.checkOutAt} variant="outline">
                  <LogOut className="size-4 mr-2" /> Check Out
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-2">
            <MonthYearPicker month={month} year={year} onMonth={setMonth} onYear={setYear} />
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {calendarDays.map(({ day, dateStr, weekend, record }) => (
              <div
                key={dateStr}
                className={`rounded-lg border border-ct-border p-2 min-h-16 text-xs ${weekend ? "bg-ct-cloud/50" : "bg-white"}`}
              >
                <p className="font-medium text-ct-navy">{day}</p>
                {weekend ? (
                  <span className="text-ct-muted">Weekend</span>
                ) : record ? (
                  <Badge className={`text-[10px] border-0 mt-1 ${STATUS_COLORS[record.status] ?? "bg-ct-cloud text-ct-muted"}`}>
                    {STATUS_LABELS[record.status] ?? record.status}
                  </Badge>
                ) : (
                  <span className="text-ct-muted">--</span>
                )}
              </div>
            ))}
          </div>
        </TabsContent>

        {/* ── Team (manager bulk-mark) ──────────────────────────────── */}
        {isManager && (
          <TabsContent value="team" className="mt-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Date</Label>
                <Input type="date" value={teamDate} onChange={(e) => setTeamDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Mark selected as</Label>
                <Select value={bulkStatus} onValueChange={setBulkStatus}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white self-end"
                onClick={submitBulkMark}
                disabled={bulkSaving || selectedEmployees.size === 0}
              >
                {bulkSaving ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Mark {selectedEmployees.size || ""} Selected
              </Button>
            </div>

            <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
              {employees.map((emp) => {
                const rec = recordsByEmployeeForTeamDate.get(emp.id);
                return (
                  <div key={emp.id} className="px-4 py-3 flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedEmployees.has(emp.id)}
                      onChange={() => toggleEmployeeSelection(emp.id)}
                      className="size-4"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ct-navy">{emp.name}</p>
                      <p className="text-xs text-ct-muted">{emp.email}</p>
                    </div>
                    {rec && (
                      <Badge className={`text-xs border-0 ${STATUS_COLORS[rec.status] ?? "bg-ct-cloud text-ct-muted"}`}>
                        {STATUS_LABELS[rec.status] ?? rec.status}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>
        )}

        {/* ── Summary ────────────────────────────────────────────────── */}
        <TabsContent value="summary" className="mt-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <MonthYearPicker month={month} year={year} onMonth={setMonth} onYear={setYear} />
            {isManager && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Department</Label>
                <Select value={summaryDept} onValueChange={setSummaryDept}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {summaries.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No summary data for this period.</CardContent>
            </Card>
          ) : (
            <div className="rounded-xl border border-ct-border bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ct-border text-xs text-ct-muted uppercase">
                    <th className="text-left px-4 py-2">Employee</th>
                    <th className="text-right px-3 py-2">Working Days</th>
                    <th className="text-right px-3 py-2">Present</th>
                    <th className="text-right px-3 py-2">Absent</th>
                    <th className="text-right px-3 py-2">Half Day</th>
                    <th className="text-right px-3 py-2">Leave</th>
                    <th className="text-right px-3 py-2">Unmarked</th>
                    <th className="text-right px-3 py-2">Payable Days</th>
                    <th className="text-right px-4 py-2">Attendance %</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((s) => (
                    <tr key={s.userId} className="border-b border-ct-border last:border-0">
                      <td className="px-4 py-2 font-medium text-ct-navy">{s.userName ?? employeesById.get(s.userId)?.name ?? "Employee"}</td>
                      <td className="px-3 py-2 text-right">{s.workingDays}</td>
                      <td className="px-3 py-2 text-right text-ct-teal">{s.present}</td>
                      <td className="px-3 py-2 text-right text-ct-error">{s.absent}</td>
                      <td className="px-3 py-2 text-right text-ct-saffron">{s.halfDay}</td>
                      <td className="px-3 py-2 text-right">{s.onLeave}</td>
                      <td className="px-3 py-2 text-right text-ct-muted">{s.unmarked}</td>
                      <td className="px-3 py-2 text-right">{s.payableDays}</td>
                      <td className="px-4 py-2 text-right font-medium">{s.attendancePercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── Holidays ───────────────────────────────────────────────── */}
        {isManager && (
          <TabsContent value="holidays" className="mt-4 space-y-3">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Date</Label>
                <Input type="date" value={newHolidayDate} onChange={(e) => setNewHolidayDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={newHolidayName} onChange={(e) => setNewHolidayName(e.target.value)} placeholder="Independence Day" />
              </div>
              <Button onClick={addHoliday} disabled={!newHolidayDate || !newHolidayName.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                <Plus className="size-4 mr-2" /> Add Holiday
              </Button>
            </div>

            <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
              {holidays.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-ct-muted">No holidays declared for {year}.</div>
              ) : (
                holidays.map((h) => (
                  <div key={h.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ct-navy">{h.name}</p>
                      <p className="text-xs text-ct-muted">{new Date(h.date).toLocaleDateString()}</p>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removeHoliday(h.id)}>
                      <Trash2 className="size-4 text-ct-error" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function MonthYearPicker({ month, year, onMonth, onYear }: { month: number; year: number; onMonth: (m: number) => void; onYear: (y: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Select value={String(month)} onValueChange={(v) => onMonth(Number(v))}>
        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <SelectItem key={m} value={String(m)}>
              {new Date(2000, m - 1, 1).toLocaleString("default", { month: "long" })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={String(year)} onValueChange={(v) => onYear(Number(v))}>
        <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
