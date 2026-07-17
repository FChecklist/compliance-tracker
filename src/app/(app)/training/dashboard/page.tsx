"use client";

export const dynamic = "force-dynamic";

// VERIDIAN Review Framework remediation, Wave B: Training / LMS
// roster/completion dashboard -- "who has/hasn't completed what",
// org-wide and per-course. Matches hr/attendance/page.tsx's Summary tab
// convention (a manager-gated table fed by a single rollup API call).
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, LayoutDashboard } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type RosterRow = { employeeId: string; employeeName: string | null; courseId: string; courseTitle: string; status: string; dueDate: string | null; completedAt: string | null };
type CourseSummary = { courseId: string; courseTitle: string; enrolled: number; inProgress: number; completed: number; completionPercent: number; overdue: number };

const STATUS_COLORS: Record<string, string> = {
  not_started: "bg-ct-cloud text-ct-muted",
  in_progress: "bg-ct-saffron/20 text-ct-saffron",
  completed: "bg-ct-teal/15 text-ct-teal",
};

export default function TrainingDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [summaries, setSummaries] = useState<CourseSummary[]>([]);
  const [courseFilter, setCourseFilter] = useState<string>("all");

  const load = useCallback(async () => {
    const params = courseFilter !== "all" ? `?courseId=${courseFilter}` : "";
    const res = await fetch(`/api/training/dashboard${params}`);
    const data = await res.json();
    setRoster(data.roster ?? []);
    setSummaries(data.summaries ?? []);
    setLoading(false);
  }, [courseFilter]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;

  return (
    <div className="space-y-4">
      <Link href="/training" className="inline-flex items-center gap-1 text-xs text-ct-muted hover:text-ct-navy">
        <ChevronLeft className="size-3.5" /> Back to Training
      </Link>

      <h1 className="text-2xl font-heading text-ct-navy flex items-center gap-2"><LayoutDashboard className="size-6 text-ct-teal" /> Training Dashboard</h1>

      <div className="rounded-xl border border-ct-border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ct-border text-xs text-ct-muted uppercase">
              <th className="text-left px-4 py-2">Course</th>
              <th className="text-right px-3 py-2">Enrolled</th>
              <th className="text-right px-3 py-2">In Progress</th>
              <th className="text-right px-3 py-2">Completed</th>
              <th className="text-right px-3 py-2">Completion %</th>
              <th className="text-right px-4 py-2">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {summaries.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-sm text-ct-muted">No courses yet.</td></tr>
            ) : summaries.map((s) => (
              <tr key={s.courseId} className="border-b border-ct-border last:border-0">
                <td className="px-4 py-2 font-medium text-ct-navy">{s.courseTitle}</td>
                <td className="px-3 py-2 text-right">{s.enrolled}</td>
                <td className="px-3 py-2 text-right text-ct-saffron">{s.inProgress}</td>
                <td className="px-3 py-2 text-right text-ct-teal">{s.completed}</td>
                <td className="px-3 py-2 text-right font-medium">{s.completionPercent}%</td>
                <td className="px-4 py-2 text-right text-ct-error">{s.overdue || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-ct-navy">Roster</p>
        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Courses</SelectItem>
            {summaries.map((s) => <SelectItem key={s.courseId} value={s.courseId}>{s.courseTitle}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
        {roster.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ct-muted">No enrollments to show.</div>
        ) : roster.map((r) => (
          <div key={`${r.employeeId}-${r.courseId}`} className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ct-navy">{r.employeeName ?? "Employee"}</p>
              <p className="text-xs text-ct-muted">{r.courseTitle}{r.dueDate ? ` · Due ${new Date(r.dueDate).toLocaleDateString()}` : ""}</p>
            </div>
            <Badge className={`text-xs border-0 ${STATUS_COLORS[r.status] ?? "bg-ct-cloud text-ct-muted"}`}>{r.status.replace("_", " ")}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
