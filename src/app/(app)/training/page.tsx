"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// VERIDIAN Review Framework remediation, Wave B (2026-07-17): Training/LMS
// hub. Three tabs: My Training (enrollments + assigned paths for the
// logged-in employee), Catalog (browse published courses, self-enroll),
// Manage (trainer/manager-only: course authoring entry point + org-wide
// roster dashboard + learning-path management). Matches
// src/app/(app)/hr/attendance/page.tsx's tab layout and design tokens.
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, GraduationCap, LayoutGrid, Users2, Plus, BookOpen, ClipboardCheck, CheckCircle2, Circle, PlayCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Course = {
  id: string; title: string; description: string | null; category: string | null; status: string;
  isMandatory: boolean; estimatedDurationMinutes: number | null;
};
type Enrollment = { id: string; courseId: string; status: string; dueDate: string | null; course: Course | null };
type RosterSummaryRow = { courseId: string; courseTitle: string; isMandatory: boolean; enrolled: number; notStarted: number; inProgress: number; completed: number };
type TrainingPath = { id: string; name: string; description: string | null; isActive: boolean; targetRole: string | null; targetDepartmentId: string | null };

const STATUS_LABELS: Record<string, string> = { not_started: "Not Started", in_progress: "In Progress", completed: "Completed" };
const STATUS_COLORS: Record<string, string> = {
  not_started: "bg-ct-cloud text-ct-muted",
  in_progress: "bg-ct-saffron/20 text-ct-saffron",
  completed: "bg-ct-teal/15 text-ct-teal",
};

export default function TrainingHubPage() {
  const [myRole, setMyRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [myEnrollments, setMyEnrollments] = useState<Enrollment[]>([]);
  const [catalog, setCatalog] = useState<Course[]>([]);
  const [enrolling, setEnrolling] = useState<string | null>(null);

  const [rosterSummary, setRosterSummary] = useState<RosterSummaryRow[]>([]);
  const [paths, setPaths] = useState<TrainingPath[]>([]);
  const [newCourseTitle, setNewCourseTitle] = useState("");
  const [newCourseDescription, setNewCourseDescription] = useState("");
  const [newCourseCategory, setNewCourseCategory] = useState("");
  const [newCourseMandatory, setNewCourseMandatory] = useState(false);
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [newPathName, setNewPathName] = useState("");
  const [newPathDescription, setNewPathDescription] = useState("");
  const [creatingPath, setCreatingPath] = useState(false);

  const isManager = myRole === "manager" || myRole === "admin" || myRole === "veridian_admin" || myRole === "branch_manager";

  const loadMe = useCallback(async () => {
    const res = await fetch("/api/me");
    const data = await res.json();
    setMyRole(data.role ?? null);
  }, []);

  const loadMyTraining = useCallback(async () => {
    const res = await fetch("/api/training/my");
    const data = await res.json();
    setMyEnrollments(data.enrollments ?? []);
  }, []);

  const loadCatalog = useCallback(async () => {
    const res = await fetch("/api/training/courses?status=published");
    const data = await res.json();
    setCatalog(data.courses ?? []);
  }, []);

  const loadRoster = useCallback(async () => {
    const res = await fetch("/api/training/roster");
    if (!res.ok) return;
    const data = await res.json();
    setRosterSummary(data.summary ?? []);
  }, []);

  const loadPaths = useCallback(async () => {
    const res = await fetch("/api/training/paths");
    const data = await res.json();
    setPaths(data.paths ?? []);
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => {
    (async () => {
      await Promise.all([loadMyTraining(), loadCatalog(), loadPaths()]);
      setLoading(false);
    })();
  }, [loadMyTraining, loadCatalog, loadPaths]);
  useEffect(() => { if (isManager) loadRoster(); }, [isManager, loadRoster]);

  const myEnrolledCourseIds = new Set(myEnrollments.map((e) => e.courseId));

  const selfEnroll = async (courseId: string) => {
    setEnrolling(courseId);
    try {
      const res = await fetch("/api/training/enrollments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId }) });
      if (!res.ok) throw new Error();
      toast.success("Enrolled");
      await loadMyTraining();
    } catch { toast.error("Failed to enroll"); } finally { setEnrolling(null); }
  };

  const createCourse = async () => {
    if (!newCourseTitle.trim()) return;
    setCreatingCourse(true);
    try {
      const res = await fetch("/api/training/courses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newCourseTitle, description: newCourseDescription, category: newCourseCategory || undefined, isMandatory: newCourseMandatory }),
      });
      if (!res.ok) throw new Error();
      const course = await res.json();
      toast.success("Course created -- add modules, lessons, and an optional quiz next");
      setNewCourseTitle(""); setNewCourseDescription(""); setNewCourseCategory(""); setNewCourseMandatory(false);
      window.location.href = `/training/courses/${course.id}`;
    } catch { toast.error("Failed to create course"); } finally { setCreatingCourse(false); }
  };

  const createPath = async () => {
    if (!newPathName.trim()) return;
    setCreatingPath(true);
    try {
      const res = await fetch("/api/training/paths", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPathName, description: newPathDescription }),
      });
      if (!res.ok) throw new Error();
      toast.success("Learning path created");
      setNewPathName(""); setNewPathDescription("");
      await loadPaths();
    } catch { toast.error("Failed to create learning path"); } finally { setCreatingPath(false); }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Training</h1>
        <p className="text-sm text-ct-muted mt-1">Courses, curricula, assessments, and completion tracking for the whole organisation.</p>
      </div>

      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine"><GraduationCap className="size-3.5 mr-1.5" /> My Training</TabsTrigger>
          <TabsTrigger value="catalog"><LayoutGrid className="size-3.5 mr-1.5" /> Catalog</TabsTrigger>
          {isManager && <TabsTrigger value="manage"><Users2 className="size-3.5 mr-1.5" /> Manage</TabsTrigger>}
        </TabsList>

        {/* ── My Training ────────────────────────────────────────────── */}
        <TabsContent value="mine" className="mt-4 space-y-3">
          {myEnrollments.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">
                No courses enrolled yet. Browse the Catalog tab to get started.
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
              {myEnrollments.map((e) => (
                <Link key={e.id} href={`/training/courses/${e.courseId}`} className="px-4 py-3 flex items-center gap-3 hover:bg-ct-cloud/40">
                  {e.status === "completed" ? <CheckCircle2 className="size-5 text-ct-teal shrink-0" /> : e.status === "in_progress" ? <PlayCircle className="size-5 text-ct-saffron shrink-0" /> : <Circle className="size-5 text-ct-muted shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ct-navy">{e.course?.title ?? "Course"}</p>
                    {e.dueDate && <p className="text-xs text-ct-muted">Due {new Date(e.dueDate).toLocaleDateString()}</p>}
                  </div>
                  <Badge className={`text-xs border-0 ${STATUS_COLORS[e.status] ?? "bg-ct-cloud text-ct-muted"}`}>{STATUS_LABELS[e.status] ?? e.status}</Badge>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Catalog ────────────────────────────────────────────────── */}
        <TabsContent value="catalog" className="mt-4 space-y-3">
          {catalog.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No published courses yet.</CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {catalog.map((c) => (
                <Card key={c.id} className="rounded-xl shadow-card bg-white">
                  <CardContent className="pt-4 pb-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-ct-navy">{c.title}</p>
                      {c.isMandatory && <Badge className="text-[10px] border-0 bg-ct-error/15 text-ct-error shrink-0">Mandatory</Badge>}
                    </div>
                    {c.description && <p className="text-xs text-ct-muted line-clamp-2">{c.description}</p>}
                    <div className="flex items-center gap-2 text-xs text-ct-muted">
                      {c.category && <Badge className="text-[10px] border-0 bg-ct-cloud text-ct-muted">{c.category}</Badge>}
                      {c.estimatedDurationMinutes && <span>{c.estimatedDurationMinutes} min</span>}
                    </div>
                    <div className="pt-1">
                      {myEnrolledCourseIds.has(c.id) ? (
                        <Link href={`/training/courses/${c.id}`}><Button size="sm" variant="outline" className="w-full">Continue</Button></Link>
                      ) : (
                        <Button size="sm" className="w-full bg-ct-teal hover:bg-ct-teal/90 text-white" disabled={enrolling === c.id} onClick={() => selfEnroll(c.id)}>
                          {enrolling === c.id ? <Loader2 className="size-4 mr-2 animate-spin" /> : <BookOpen className="size-4 mr-2" />} Enroll
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Manage (trainer workspace) ─────────────────────────────── */}
        {isManager && (
          <TabsContent value="manage" className="mt-4 space-y-6">
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-ct-navy flex items-center gap-1.5"><Plus className="size-4" /> New Course</h2>
              <div className="rounded-xl border border-ct-border bg-white p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
                    <Input value={newCourseTitle} onChange={(e) => setNewCourseTitle(e.target.value)} placeholder="POSH Awareness Training" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Category</Label>
                    <Input value={newCourseCategory} onChange={(e) => setNewCourseCategory(e.target.value)} placeholder="compliance / safety / onboarding" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Description</Label>
                  <Textarea value={newCourseDescription} onChange={(e) => setNewCourseDescription(e.target.value)} rows={2} />
                </div>
                <label className="flex items-center gap-2 text-sm text-ct-navy">
                  <input type="checkbox" className="size-4" checked={newCourseMandatory} onChange={(e) => setNewCourseMandatory(e.target.checked)} />
                  Mandatory course
                </label>
                <Button onClick={createCourse} disabled={creatingCourse || !newCourseTitle.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                  {creatingCourse ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Plus className="size-4 mr-2" />} Create &amp; Author Course
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-ct-navy flex items-center gap-1.5"><ClipboardCheck className="size-4" /> Roster &amp; Completion Dashboard</h2>
              {rosterSummary.length === 0 ? (
                <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-6 pb-6 text-center text-sm text-ct-muted">No published courses with enrollments yet.</CardContent></Card>
              ) : (
                <div className="rounded-xl border border-ct-border bg-white overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ct-border text-xs text-ct-muted uppercase">
                        <th className="text-left px-4 py-2">Course</th>
                        <th className="text-right px-3 py-2">Enrolled</th>
                        <th className="text-right px-3 py-2">Not Started</th>
                        <th className="text-right px-3 py-2">In Progress</th>
                        <th className="text-right px-4 py-2">Completed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rosterSummary.map((r) => (
                        <tr key={r.courseId} className="border-b border-ct-border last:border-0">
                          <td className="px-4 py-2">
                            <Link href={`/training/courses/${r.courseId}`} className="font-medium text-ct-navy hover:underline">{r.courseTitle}</Link>
                            {r.isMandatory && <Badge className="ml-2 text-[10px] border-0 bg-ct-error/15 text-ct-error">Mandatory</Badge>}
                          </td>
                          <td className="px-3 py-2 text-right">{r.enrolled}</td>
                          <td className="px-3 py-2 text-right text-ct-muted">{r.notStarted}</td>
                          <td className="px-3 py-2 text-right text-ct-saffron">{r.inProgress}</td>
                          <td className="px-4 py-2 text-right text-ct-teal font-medium">{r.completed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-ct-navy flex items-center gap-1.5"><GraduationCap className="size-4" /> Learning Paths</h2>
              <div className="rounded-xl border border-ct-border bg-white p-4 space-y-3">
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                    <Input value={newPathName} onChange={(e) => setNewPathName(e.target.value)} placeholder="New Manager Onboarding" />
                  </div>
                  <div className="space-y-1.5 flex-1 min-w-48">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Description</Label>
                    <Input value={newPathDescription} onChange={(e) => setNewPathDescription(e.target.value)} />
                  </div>
                  <Button onClick={createPath} disabled={creatingPath || !newPathName.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                    {creatingPath ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Plus className="size-4 mr-2" />} Create Path
                  </Button>
                </div>
              </div>
              {paths.length > 0 && (
                <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
                  {paths.map((p) => (
                    <Link key={p.id} href={`/training/paths`} className="px-4 py-3 flex items-center gap-3 hover:bg-ct-cloud/40">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ct-navy">{p.name}</p>
                        {p.description && <p className="text-xs text-ct-muted">{p.description}</p>}
                      </div>
                      {!p.isActive && <Badge className="text-[10px] border-0 bg-ct-cloud text-ct-muted">Inactive</Badge>}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
