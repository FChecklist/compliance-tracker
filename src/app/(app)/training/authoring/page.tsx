"use client";

export const dynamic = "force-dynamic";

// VERIDIAN Review Framework remediation, Wave B: Training / LMS trainer
// workspace -- course authoring (list/create, edit via /training/authoring/
// [id]) and curricula (learning paths: list/create/assign). Manager-or-above
// only (enforced server-side by every /api/training POST/PATCH/DELETE via
// requireRole; this page itself doesn't re-check role -- middleware/API is
// the real gate, matching this codebase's other authoring surfaces).
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, Settings2, Route, ChevronRight, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Course = { id: string; title: string; status: string; category: string | null; isMandatory: boolean };
type Path = { id: string; name: string; description: string | null; isActive: boolean };

export default function TrainingAuthoringPage() {
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<Course[]>([]);
  const [paths, setPaths] = useState<Path[]>([]);

  const [newCourseTitle, setNewCourseTitle] = useState("");
  const [newCourseCategory, setNewCourseCategory] = useState("");
  const [newCourseMandatory, setNewCourseMandatory] = useState(false);
  const [creatingCourse, setCreatingCourse] = useState(false);

  const [newPathName, setNewPathName] = useState("");
  const [newPathDescription, setNewPathDescription] = useState("");
  const [creatingPath, setCreatingPath] = useState(false);

  const load = useCallback(async () => {
    const [coursesRes, pathsRes] = await Promise.all([fetch("/api/training/courses"), fetch("/api/training/paths")]);
    const [coursesData, pathsData] = await Promise.all([coursesRes.json(), pathsRes.json()]);
    setCourses(coursesData.courses ?? []);
    setPaths(pathsData.paths ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const createCourse = async () => {
    if (!newCourseTitle.trim()) return;
    setCreatingCourse(true);
    try {
      const res = await fetch("/api/training/courses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newCourseTitle, category: newCourseCategory || undefined, isMandatory: newCourseMandatory }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Course created");
      setNewCourseTitle(""); setNewCourseCategory(""); setNewCourseMandatory(false);
      await load();
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : "Failed to create course"); }
    finally { setCreatingCourse(false); }
  };

  const createPath = async () => {
    if (!newPathName.trim()) return;
    setCreatingPath(true);
    try {
      const res = await fetch("/api/training/paths", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPathName, description: newPathDescription || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Curriculum created");
      setNewPathName(""); setNewPathDescription("");
      await load();
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : "Failed to create curriculum"); }
    finally { setCreatingPath(false); }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy flex items-center gap-2"><Settings2 className="size-6 text-ct-teal" /> Training Authoring</h1>
        <p className="text-sm text-ct-muted mt-1">Create and manage courses, quizzes, and curricula.</p>
      </div>

      <Tabs defaultValue="courses">
        <TabsList>
          <TabsTrigger value="courses">Courses</TabsTrigger>
          <TabsTrigger value="paths"><Route className="size-3.5 mr-1.5" /> Curricula</TabsTrigger>
        </TabsList>

        {/* ── Courses ────────────────────────────────────────────────── */}
        <TabsContent value="courses" className="mt-4 space-y-3">
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="pt-4 pb-4 space-y-3">
              <p className="text-xs font-semibold text-ct-muted uppercase">New Course</p>
              <div className="flex gap-2 flex-wrap items-end">
                <div className="flex-1 min-w-40 space-y-1.5">
                  <Label className="text-xs">Title</Label>
                  <Input value={newCourseTitle} onChange={(e) => setNewCourseTitle(e.target.value)} placeholder="POSH Awareness 2026" />
                </div>
                <div className="w-40 space-y-1.5">
                  <Label className="text-xs">Category</Label>
                  <Input value={newCourseCategory} onChange={(e) => setNewCourseCategory(e.target.value)} placeholder="compliance" />
                </div>
                <label className="flex items-center gap-1.5 text-xs text-ct-muted pb-2">
                  <input type="checkbox" checked={newCourseMandatory} onChange={(e) => setNewCourseMandatory(e.target.checked)} /> Mandatory
                </label>
                <Button onClick={createCourse} disabled={creatingCourse || !newCourseTitle.trim()} className="bg-ct-teal hover:bg-ct-teal/90 text-white">
                  {creatingCourse ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Plus className="size-4 mr-2" />} Create
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
            {courses.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-ct-muted">No courses yet.</div>
            ) : (
              courses.map((c) => (
                <Link key={c.id} href={`/training/authoring/${c.id}`} className="px-4 py-3 flex items-center gap-3 hover:bg-ct-cloud/40">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ct-navy">{c.title}</p>
                    <p className="text-xs text-ct-muted">{c.category ?? "General"}{c.isMandatory ? " · Mandatory" : ""}</p>
                  </div>
                  <Badge className={`text-[10px] border-0 ${c.status === "published" ? "bg-ct-teal/15 text-ct-teal" : c.status === "archived" ? "bg-ct-cloud text-ct-muted" : "bg-ct-saffron/20 text-ct-saffron"}`}>
                    {c.status}
                  </Badge>
                  <ChevronRight className="size-4 text-ct-muted" />
                </Link>
              ))
            )}
          </div>
        </TabsContent>

        {/* ── Curricula ──────────────────────────────────────────────── */}
        <TabsContent value="paths" className="mt-4 space-y-3">
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="pt-4 pb-4 space-y-3">
              <p className="text-xs font-semibold text-ct-muted uppercase">New Curriculum</p>
              <div className="flex gap-2 flex-wrap items-end">
                <div className="flex-1 min-w-40 space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input value={newPathName} onChange={(e) => setNewPathName(e.target.value)} placeholder="New Manager Onboarding" />
                </div>
                <div className="flex-1 min-w-40 space-y-1.5">
                  <Label className="text-xs">Description</Label>
                  <Textarea value={newPathDescription} onChange={(e) => setNewPathDescription(e.target.value)} rows={1} />
                </div>
                <Button onClick={createPath} disabled={creatingPath || !newPathName.trim()} className="bg-ct-teal hover:bg-ct-teal/90 text-white">
                  {creatingPath ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Plus className="size-4 mr-2" />} Create
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
            {paths.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-ct-muted">No curricula yet.</div>
            ) : (
              paths.map((p) => <CurriculumRow key={p.id} path={p} courses={courses} onChanged={load} />)
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CurriculumRow({ path, courses, onChanged }: { path: Path; courses: Course[]; onChanged: () => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [pathCourses, setPathCourses] = useState<{ courseId: string; course: Course | null }[]>([]);
  const [addCourseId, setAddCourseId] = useState("");
  const [assignRole, setAssignRole] = useState("");
  const [busy, setBusy] = useState(false);

  const loadDetail = async () => {
    const res = await fetch(`/api/training/paths/${path.id}`);
    const data = await res.json();
    setPathCourses(data.courses ?? []);
  };

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next) await loadDetail();
  };

  const addCourse = async () => {
    if (!addCourseId) return;
    setBusy(true);
    try {
      await fetch(`/api/training/paths/${path.id}/courses`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId: addCourseId }),
      });
      setAddCourseId("");
      await loadDetail();
    } finally { setBusy(false); }
  };

  const assignByRole = async () => {
    if (!assignRole.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/training/paths/${path.id}/assign`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: assignRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Assigned to ${data.results?.length ?? 0} employee(s) with role "${assignRole}"`);
      setAssignRole("");
      await onChanged();
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : "Failed to assign"); }
    finally { setBusy(false); }
  };

  return (
    <div className="px-4 py-3">
      <button onClick={toggle} className="w-full flex items-center gap-3 text-left">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ct-navy">{path.name}</p>
          {path.description && <p className="text-xs text-ct-muted">{path.description}</p>}
        </div>
        <ChevronRight className={`size-4 text-ct-muted transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>
      {expanded && (
        <div className="mt-3 pl-2 border-l-2 border-ct-border space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-ct-muted uppercase">Courses in this curriculum</p>
            {pathCourses.length === 0 ? <p className="text-xs text-ct-muted">None yet.</p> : (
              <ul className="text-xs text-ct-navy space-y-1">
                {pathCourses.map((pc) => <li key={pc.courseId}>{pc.course?.title ?? pc.courseId}</li>)}
              </ul>
            )}
            <div className="flex gap-2 items-end">
              <Select value={addCourseId} onValueChange={setAddCourseId}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Add a course..." /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" disabled={busy || !addCourseId} onClick={addCourse}>Add</Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-ct-muted uppercase">Assign to a role</p>
            <div className="flex gap-2 items-end">
              <Input className="w-56 h-8 text-xs" value={assignRole} onChange={(e) => setAssignRole(e.target.value)} placeholder="e.g. manager" />
              <Button size="sm" disabled={busy || !assignRole.trim()} onClick={assignByRole} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                <Send className="size-3.5 mr-1.5" /> Assign
              </Button>
            </div>
            <p className="text-[11px] text-ct-muted">Enrolls every employee with this role in every course above. Department-based assignment uses the same /assign endpoint with a departmentId -- not exposed in this UI yet, see PR description for scope notes.</p>
          </div>
        </div>
      )}
    </div>
  );
}
