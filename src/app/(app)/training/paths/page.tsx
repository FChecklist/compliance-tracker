"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// VERIDIAN Review Framework remediation, Wave B (2026-07-17): Learning
// path management -- the "required training for role X" workspace. Manager
// only (route itself doesn't hard-block non-managers client-side, but every
// mutating call is server-gated via requireRole in the API routes).
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type TrainingPath = { id: string; name: string; description: string | null; isActive: boolean };
type Course = { id: string; title: string; status: string };
type Department = { id: string; name: string };
type PathDetail = TrainingPath & { courses: { id: string; courseId: string; isRequired: boolean; course: Course | null }[] };

const ROLE_OPTIONS = ["member", "team_member", "senior_professional", "manager", "branch_manager", "admin"];

export default function TrainingPathsPage() {
  const [paths, setPaths] = useState<TrainingPath[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [pathDetail, setPathDetail] = useState<PathDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [addCourseId, setAddCourseId] = useState<string>("");
  const [assignMode, setAssignMode] = useState<"individual" | "department" | "role">("role");
  const [assignRole, setAssignRole] = useState<string>(ROLE_OPTIONS[0]!);
  const [assignDepartmentId, setAssignDepartmentId] = useState<string>("");
  const [assigning, setAssigning] = useState(false);

  const loadPaths = useCallback(async () => {
    const res = await fetch("/api/training/paths");
    const data = await res.json();
    setPaths(data.paths ?? []);
    if (!selectedPathId && data.paths?.[0]) setSelectedPathId(data.paths[0].id);
  }, [selectedPathId]);

  const loadCourses = useCallback(async () => {
    const res = await fetch("/api/training/courses?status=published");
    const data = await res.json();
    setCourses(data.courses ?? []);
  }, []);

  const loadDepartments = useCallback(async () => {
    const res = await fetch("/api/departments");
    const data = await res.json();
    setDepartments(data.departments ?? []);
  }, []);

  const loadPathDetail = useCallback(async () => {
    if (!selectedPathId) { setPathDetail(null); return; }
    const res = await fetch(`/api/training/paths/${selectedPathId}`);
    if (!res.ok) return;
    setPathDetail(await res.json());
  }, [selectedPathId]);

  useEffect(() => {
    (async () => { await Promise.all([loadPaths(), loadCourses(), loadDepartments()]); setLoading(false); })();
  }, [loadPaths, loadCourses, loadDepartments]);
  useEffect(() => { loadPathDetail(); }, [loadPathDetail]);

  const addCourseToPath = async () => {
    if (!selectedPathId || !addCourseId) return;
    try {
      const res = await fetch(`/api/training/paths/${selectedPathId}/courses`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId: addCourseId }),
      });
      if (!res.ok) throw new Error();
      toast.success("Course added to path");
      setAddCourseId("");
      await loadPathDetail();
    } catch { toast.error("Failed to add course"); }
  };

  const assign = async () => {
    if (!selectedPathId) return;
    setAssigning(true);
    try {
      const body: Record<string, unknown> = {};
      if (assignMode === "role") body.role = assignRole;
      else if (assignMode === "department") body.departmentId = assignDepartmentId;
      const res = await fetch(`/api/training/paths/${selectedPathId}/assign`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const result = await res.json();
      toast.success(`Assigned to ${result.assignments.length} employee(s), ${result.enrollments.length} enrollment(s) created`);
    } catch { toast.error("Failed to assign training path"); } finally { setAssigning(false); }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;

  return (
    <div className="space-y-4">
      <Link href="/training" className="text-xs text-ct-muted hover:text-ct-navy inline-flex items-center gap-1"><ArrowLeft className="size-3.5" /> Back to Training</Link>
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Learning Paths</h1>
        <p className="text-sm text-ct-muted mt-1">Ordered course sequences assigned to a role, department, or individual employee -- the required-training-for-role mechanism.</p>
      </div>

      {paths.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No learning paths yet -- create one from the Training hub&apos;s Manage tab.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border md:col-span-1">
            {paths.map((p) => (
              <button key={p.id} onClick={() => setSelectedPathId(p.id)} className={`w-full text-left px-4 py-3 hover:bg-ct-cloud/40 ${selectedPathId === p.id ? "bg-ct-cloud/60" : ""}`}>
                <p className="text-sm font-medium text-ct-navy">{p.name}</p>
                {!p.isActive && <Badge className="text-[10px] border-0 bg-ct-cloud text-ct-muted mt-1">Inactive</Badge>}
              </button>
            ))}
          </div>

          {pathDetail && (
            <div className="md:col-span-2 space-y-4">
              <Card className="rounded-xl shadow-card bg-white">
                <CardContent className="pt-4 pb-4 space-y-3">
                  <p className="text-sm font-medium text-ct-navy">Courses in this path</p>
                  <div className="space-y-1.5">
                    {pathDetail.courses.map((pc) => (
                      <div key={pc.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-ct-cloud/40">
                        <span className="flex-1">{pc.course?.title ?? "Course"}</span>
                        {pc.isRequired && <Badge className="text-[10px] border-0 bg-ct-teal/15 text-ct-teal">Required</Badge>}
                      </div>
                    ))}
                    {pathDetail.courses.length === 0 && <p className="text-xs text-ct-muted">No courses added yet.</p>}
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="space-y-1 flex-1">
                      <Label className="text-[10px] font-semibold text-ct-muted uppercase">Add Course</Label>
                      <Select value={addCourseId} onValueChange={setAddCourseId}>
                        <SelectTrigger><SelectValue placeholder="Select a published course" /></SelectTrigger>
                        <SelectContent>
                          {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={addCourseToPath} disabled={!addCourseId} variant="outline"><Plus className="size-4 mr-1.5" /> Add</Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-xl shadow-card bg-white">
                <CardContent className="pt-4 pb-4 space-y-3">
                  <p className="text-sm font-medium text-ct-navy">Assign this path</p>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div className="space-y-1">
                      <Label className="text-[10px] font-semibold text-ct-muted uppercase">Assign by</Label>
                      <Select value={assignMode} onValueChange={(v) => setAssignMode(v as typeof assignMode)}>
                        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="role">Role</SelectItem>
                          <SelectItem value="department">Department</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {assignMode === "role" && (
                      <div className="space-y-1">
                        <Label className="text-[10px] font-semibold text-ct-muted uppercase">Role</Label>
                        <Select value={assignRole} onValueChange={setAssignRole}>
                          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {assignMode === "department" && (
                      <div className="space-y-1">
                        <Label className="text-[10px] font-semibold text-ct-muted uppercase">Department</Label>
                        <Select value={assignDepartmentId} onValueChange={setAssignDepartmentId}>
                          <SelectTrigger className="w-44"><SelectValue placeholder="Select department" /></SelectTrigger>
                          <SelectContent>
                            {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <Button onClick={assign} disabled={assigning || (assignMode === "department" && !assignDepartmentId)} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                      {assigning ? <Loader2 className="size-4 mr-2 animate-spin" /> : null} Assign &amp; Enroll
                    </Button>
                  </div>
                  <p className="text-xs text-ct-muted">Every matching employee is enrolled in every required course in this path -- existing enrollments are left untouched, not duplicated.</p>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
