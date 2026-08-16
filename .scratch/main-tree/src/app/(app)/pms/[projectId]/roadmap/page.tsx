"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { Milestone } from "lucide-react";
import ProjectNav from "@/components/pms/ProjectNav";

type Issue = { id: string; number: number; title: string; startDate: string | null; dueDate: string | null };
type PmsMilestone = { id: string; name: string; targetDate: string | null };

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export default function RoadmapPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [projectName, setProjectName] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [milestones, setMilestones] = useState<PmsMilestone[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [projectRes, issuesRes, milestonesRes] = await Promise.all([
      fetch(`/api/projects/${projectId}`),
      fetch(`/api/pms/issues?projectId=${projectId}`),
      fetch(`/api/pms/milestones?projectId=${projectId}`),
    ]);
    const [project, issuesData, milestonesData] = await Promise.all([projectRes.json(), issuesRes.json(), milestonesRes.json()]);
    setProjectName(project.name ?? "Project");
    setIssues((issuesData.issues ?? []).filter((i: Issue) => i.startDate || i.dueDate));
    setMilestones((milestonesData.milestones ?? []).filter((m: PmsMilestone) => m.targetDate));
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const timeline = useMemo(() => {
    const dates: number[] = [];
    for (const issue of issues) {
      if (issue.startDate) dates.push(new Date(issue.startDate).getTime());
      if (issue.dueDate) dates.push(new Date(issue.dueDate).getTime());
    }
    for (const m of milestones) {
      if (m.targetDate) dates.push(new Date(m.targetDate).getTime());
    }
    if (dates.length === 0) return null;

    const min = Math.min(...dates);
    const max = Math.max(...dates);
    const totalDays = Math.max(1, Math.round((max - min) / MS_PER_DAY));

    const pct = (d: string) => ((new Date(d).getTime() - min) / MS_PER_DAY / totalDays) * 100;

    return {
      minLabel: new Date(min).toLocaleDateString(),
      maxLabel: new Date(max).toLocaleDateString(),
      bars: issues.map((issue) => {
        const start = issue.startDate ?? issue.dueDate!;
        const end = issue.dueDate ?? issue.startDate!;
        const left = pct(start);
        const width = Math.max(1.5, pct(end) - left);
        return { id: issue.id, label: `#${issue.number} ${issue.title}`, left, width };
      }),
      markers: milestones.map((m) => ({ id: m.id, label: m.name, left: pct(m.targetDate!) })),
    };
  }, [issues, milestones]);

  return (
    <div className="space-y-4">
      <ProjectNav projectId={projectId} projectName={projectName} />

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : !timeline ? (
        <p className="text-sm text-ct-muted py-10 text-center">No issues or milestones with dates yet.</p>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white p-6">
          <div className="flex justify-between text-xs text-ct-muted mb-4">
            <span>{timeline.minLabel}</span>
            <span>{timeline.maxLabel}</span>
          </div>
          <div className="relative space-y-2">
            {timeline.markers.map((marker) => (
              <div
                key={marker.id}
                className="absolute top-0 bottom-0 w-px bg-ct-saffron/50 z-0"
                style={{ left: `${marker.left}%` }}
                title={marker.label}
              >
                <Milestone className="size-3.5 text-ct-saffron absolute -top-1 -left-[7px]" />
              </div>
            ))}
            {timeline.bars.map((bar) => (
              <div key={bar.id} className="relative h-8 flex items-center">
                <div
                  className="absolute h-6 rounded-md bg-ct-teal/80 flex items-center px-2 z-10"
                  style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                  title={bar.label}
                >
                  <span className="text-[11px] text-white truncate">{bar.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
