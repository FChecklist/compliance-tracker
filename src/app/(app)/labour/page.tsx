"use client";

export const dynamic = "force-dynamic";

// Wave 6 batch 1 (compliance-tracker/PROJEXA merge, module-mapping report
// finding GAP-CONSTR): site-labour manpower roster + daily attendance,
// ported from PROJEXA's own LabourClient.tsx (construction-labour-
// service.ts backend) onto this repo's own list+dialog+ProjectPicker shell.
// Deliberately a DIFFERENT concept from HR employee attendance
// (hr-attendance-service.ts, /hr/attendance) per the wave brief -- this
// page only ever calls /api/construction/{labour-roster,attendance}
// (session-auth, native routes -- not the /v1/projexa/* API-key-capable
// aliases, since this is compliance-tracker's own authenticated UI, not an
// external caller) and never touches hr-attendance-service.ts or its
// tables.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, HardHat } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type RosterEntry = { id: string; name: string; trade: string | null; skillLevel: string | null; dailyRate: string; isActive: boolean };
type AttendanceEntry = { id: string; rosterId: string; attendanceDate: string; status: string; hoursWorked: string | null; dailyCost: string };

const ATTENDANCE_COLORS: Record<string, string> = {
  present: "bg-green-100 text-green-700",
  half_day: "bg-ct-saffron/20 text-ct-saffron",
  absent: "bg-red-100 text-red-700",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function LabourPage() {
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const [rosterOpen, setRosterOpen] = useState(false);
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [skillLevel, setSkillLevel] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [rosterSubmitting, setRosterSubmitting] = useState(false);

  const [attOpen, setAttOpen] = useState(false);
  const [rosterId, setRosterId] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(todayIso);
  const [status, setStatus] = useState("present");
  const [hoursWorked, setHoursWorked] = useState("");
  const [attSubmitting, setAttSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: PickerProject[] = d.projects ?? [];
        setProjects(list);
        if (list.length > 0) setProjectId((prev) => prev || list[0].id);
      })
      .catch(() => toast.error("Failed to load projects"))
      .finally(() => setLoadingProjects(false));
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [rosterRes, attRes] = await Promise.all([
        fetch(`/api/construction/labour-roster?projectId=${encodeURIComponent(projectId)}`),
        fetch(`/api/construction/attendance?projectId=${encodeURIComponent(projectId)}`),
      ]);
      const rosterData = await rosterRes.json();
      const attData = await attRes.json();
      setRoster(rosterData.roster ?? []);
      setAttendance(attData.attendance ?? []);
    } catch {
      toast.error("Failed to load manpower data");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const createRoster = async () => {
    if (!projectId || !name.trim() || !dailyRate) return;
    setRosterSubmitting(true);
    try {
      const res = await fetch("/api/construction/labour-roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, name, trade: trade || undefined, skillLevel: skillLevel || undefined,
          dailyRate: Number(dailyRate),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Worker added to roster");
      setRosterOpen(false);
      setName(""); setTrade(""); setSkillLevel(""); setDailyRate("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to add worker");
    } finally {
      setRosterSubmitting(false);
    }
  };

  const createAttendance = async () => {
    if (!projectId || !rosterId || !attendanceDate) return;
    setAttSubmitting(true);
    try {
      const res = await fetch("/api/construction/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, rosterId, attendanceDate, status,
          hoursWorked: hoursWorked ? Number(hoursWorked) : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Attendance recorded");
      setAttOpen(false);
      setHoursWorked("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to record attendance");
    } finally {
      setAttSubmitting(false);
    }
  };

  const workerName = (id: string) => roster.find((r) => r.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Labour</h1>
        <p className="text-sm text-ct-muted mt-1">Site manpower roster and daily attendance -- distinct from company-employee HR attendance under People &amp; HR.</p>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={HardHat} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          <Tabs defaultValue="roster">
            <TabsList>
              <TabsTrigger value="roster">Roster</TabsTrigger>
              <TabsTrigger value="attendance">Attendance</TabsTrigger>
            </TabsList>

            <TabsContent value="roster" className="mt-4 space-y-3">
              <div className="flex justify-end">
                <Dialog open={rosterOpen} onOpenChange={setRosterOpen}>
                  <DialogTrigger asChild>
                    <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"><Plus className="size-4 mr-1" /> Add Worker</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add Worker to Roster</DialogTitle><DialogDescription>Added to the selected project's manpower roster.</DialogDescription></DialogHeader>
                    <div className="space-y-4 py-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-ct-muted uppercase">Trade (optional)</Label>
                          <Input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="Mason, Electrician" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-ct-muted uppercase">Skill Level (optional)</Label>
                          <Input value={skillLevel} onChange={(e) => setSkillLevel(e.target.value)} placeholder="Skilled" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-ct-muted uppercase">Daily Rate</Label>
                        <Input type="number" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={createRoster} disabled={rosterSubmitting || !name.trim() || !dailyRate} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                        {rosterSubmitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                        Add Worker
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              {loading ? (
                <p className="text-sm text-ct-muted">Loading...</p>
              ) : roster.length === 0 ? (
                <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No workers on the roster yet.</CardContent></Card>
              ) : (
                <Card className="rounded-xl shadow-card bg-white">
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Name</TableHead><TableHead>Trade</TableHead><TableHead>Daily Rate</TableHead><TableHead>Status</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {roster.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium text-ct-navy">{r.name}</TableCell>
                            <TableCell className="text-ct-muted">{r.trade ?? "--"}</TableCell>
                            <TableCell>{r.dailyRate}</TableCell>
                            <TableCell><Badge className={`text-xs border-0 ${r.isActive ? "bg-green-100 text-green-700" : "bg-ct-cloud text-ct-muted"}`}>{r.isActive ? "active" : "inactive"}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="attendance" className="mt-4 space-y-3">
              <div className="flex justify-end">
                <Dialog open={attOpen} onOpenChange={setAttOpen}>
                  <DialogTrigger asChild>
                    <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={roster.length === 0}>
                      <Plus className="size-4 mr-1" /> Mark Attendance
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Mark Attendance</DialogTitle><DialogDescription>One record per worker per date.</DialogDescription></DialogHeader>
                    <div className="space-y-4 py-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-ct-muted uppercase">Worker</Label>
                        <Select value={rosterId} onValueChange={setRosterId}>
                          <SelectTrigger><SelectValue placeholder="Select worker" /></SelectTrigger>
                          <SelectContent>{roster.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-ct-muted uppercase">Date</Label>
                          <Input type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-ct-muted uppercase">Status</Label>
                          <Select value={status} onValueChange={setStatus}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="present">Present</SelectItem>
                              <SelectItem value="half_day">Half Day</SelectItem>
                              <SelectItem value="absent">Absent</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-ct-muted uppercase">Hours Worked (optional)</Label>
                        <Input type="number" value={hoursWorked} onChange={(e) => setHoursWorked(e.target.value)} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={createAttendance} disabled={attSubmitting || !rosterId} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                        {attSubmitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                        Record
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              {loading ? (
                <p className="text-sm text-ct-muted">Loading...</p>
              ) : attendance.length === 0 ? (
                <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No attendance recorded yet.</CardContent></Card>
              ) : (
                <Card className="rounded-xl shadow-card bg-white">
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Date</TableHead><TableHead>Worker</TableHead><TableHead>Status</TableHead><TableHead>Hours</TableHead><TableHead className="text-right">Cost</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {attendance.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell className="text-ct-muted whitespace-nowrap">{new Date(a.attendanceDate).toLocaleDateString()}</TableCell>
                            <TableCell className="font-medium text-ct-navy">{workerName(a.rosterId)}</TableCell>
                            <TableCell><Badge className={`text-xs border-0 ${ATTENDANCE_COLORS[a.status] ?? "bg-ct-cloud text-ct-muted"}`}>{a.status.replace(/_/g, " ")}</Badge></TableCell>
                            <TableCell>{a.hoursWorked ?? "--"}</TableCell>
                            <TableCell className="text-right">{a.dailyCost}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
