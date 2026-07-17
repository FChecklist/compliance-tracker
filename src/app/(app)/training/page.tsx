"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// VERIDIAN Review Framework remediation, Wave B: Training / LMS -- employee
// hub. Two tabs: My Learning (my enrollments + progress), Catalog (browse
// published courses, self-enroll). Authoring and the manager roster
// dashboard are separate pages (/training/authoring, /training/dashboard,
// linked from here when isManager) -- too much surface for tabs on this
// same page, matching hr/attendance/page.tsx's tab-gating convention for
// the parts that DO fit here.
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, GraduationCap, BookOpen, LayoutDashboard, Settings2, Clock, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Course = {
  id: string; title: string; description: string | null; category: string | null
  isMandatory: boolean; status: string; estimatedDurationMinutes: number | null
};
type Enrollment = {
  id: string; courseId: string; status: string; enrolledAt: string; dueDate: string | null
};

const STATUS_COLORS: Record<string, string> = {
  not_started: "bg-ct-cloud text-ct-muted",
  in_progress: "bg-ct-saffron/20 text-ct-saffron",
  completed: "bg-ct-teal/15 text-ct-teal",
};
const STATUS_LABELS: Record<string, string> = {
  not_started: "Not Started", in_progress: "In Progress", completed: "Completed",
};

export default function TrainingHubPage() {
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [enrolling, setEnrolling] = useState<string | null>(null);

  const isManager = myRole === "manager" || myRole === "admin" || myRole === "veridian_admin" || myRole === "branch_manager";

  const loadAll = useCallback(async () => {
    const [meRes, coursesRes, enrollRes] = await Promise.all([
      fetch("/api/me"),
      fetch("/api/training/courses?status=published"),
      fetch("/api/training/enrollments"),
    ]);
    const [meData, coursesData, enrollData] = await Promise.all([meRes.json(), coursesRes.json(), enrollRes.json()]);
    setMyRole(meData.role ?? null);
    setCourses(coursesData.courses ?? []);
    setEnrollments(enrollData.enrollments ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const enrollmentByCourse = new Map(enrollments.map((e) => [e.courseId, e]));
  const coursesById = new Map(courses.map((c) => [c.id, c]));

  const selfEnroll = async (courseId: string) => {
    setEnrolling(courseId);
    try {
      const res = await fetch("/api/training/enrollments", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error); }
      toast.success("Enrolled");
      await loadAll();
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : "Failed to enroll"); }
    finally { setEnrolling(null); }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy flex items-center gap-2">
            <GraduationCap className="size-6 text-ct-teal" /> Training &amp; Learning
          </h1>
          <p className="text-sm text-ct-muted mt-1">Courses, curricula, and completion tracking for your organisation.</p>
        </div>
        {isManager && (
          <div className="flex gap-2">
            <Link href="/training/authoring">
              <Button variant="outline"><Settings2 className="size-4 mr-2" /> Authoring Workspace</Button>
            </Link>
            <Link href="/training/dashboard">
              <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"><LayoutDashboard className="size-4 mr-2" /> Team Dashboard</Button>
            </Link>
          </div>
        )}
      </div>

      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine"><BookOpen className="size-3.5 mr-1.5" /> My Learning</TabsTrigger>
          <TabsTrigger value="catalog"><GraduationCap className="size-3.5 mr-1.5" /> Catalog</TabsTrigger>
        </TabsList>

        {/* ── My Learning ────────────────────────────────────────────── */}
        <TabsContent value="mine" className="mt-4">
          {enrollments.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">
                You have no active enrollments yet -- browse the Catalog tab to get started.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {enrollments.map((e) => {
                const course = coursesById.get(e.courseId);
                return (
                  <Link key={e.id} href={`/training/courses/${e.courseId}`}>
                    <Card className="rounded-xl shadow-card bg-white hover:shadow-md transition-shadow cursor-pointer h-full">
                      <CardContent className="pt-4 pb-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-ct-navy">{course?.title ?? "Course"}</p>
                          <Badge className={`text-[10px] border-0 shrink-0 ${STATUS_COLORS[e.status] ?? "bg-ct-cloud text-ct-muted"}`}>
                            {e.status === "completed" ? <CheckCircle2 className="size-3 mr-1" /> : <Clock className="size-3 mr-1" />}
                            {STATUS_LABELS[e.status] ?? e.status}
                          </Badge>
                        </div>
                        {course?.category && <p className="text-xs text-ct-muted">{course.category}</p>}
                        {e.dueDate && <p className="text-xs text-ct-muted">Due {new Date(e.dueDate).toLocaleDateString()}</p>}
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Catalog ────────────────────────────────────────────────── */}
        <TabsContent value="catalog" className="mt-4">
          {courses.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No published courses yet.</CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {courses.map((c) => {
                const enrollment = enrollmentByCourse.get(c.id);
                return (
                  <Card key={c.id} className="rounded-xl shadow-card bg-white">
                    <CardContent className="pt-4 pb-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-ct-navy">{c.title}</p>
                        {c.isMandatory && <Badge className="text-[10px] border-0 bg-ct-error/15 text-ct-error shrink-0">Mandatory</Badge>}
                      </div>
                      {c.description && <p className="text-xs text-ct-muted line-clamp-2">{c.description}</p>}
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs text-ct-muted">
                          {c.category ?? "General"}{c.estimatedDurationMinutes ? ` · ${c.estimatedDurationMinutes} min` : ""}
                        </span>
                        {enrollment ? (
                          <Link href={`/training/courses/${c.id}`}>
                            <Button size="sm" variant="outline">{enrollment.status === "completed" ? "Review" : "Continue"}</Button>
                          </Link>
                        ) : (
                          <Button size="sm" className="bg-ct-teal hover:bg-ct-teal/90 text-white" disabled={enrolling === c.id} onClick={() => selfEnroll(c.id)}>
                            {enrolling === c.id ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : null} Enroll
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
