"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import ProjectNav from "@/components/pms/ProjectNav";
import CreateIssueDialog from "@/components/pms/CreateIssueDialog";
import IssueDetailPanel from "@/components/pms/IssueDetailPanel";

type Issue = {
  id: string;
  number: number;
  title: string;
  priority: string;
  statusId: string;
  position: string;
};

type IssueStatus = { id: string; name: string; group: string; position: number };

const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-emerald-500",
  no_priority: "bg-ct-muted",
};

function IssueCard({ issue, onClick }: { issue: Issue; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: issue.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10 } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`bg-white rounded-lg border border-ct-border p-3 mb-2 cursor-pointer hover:shadow-md transition-shadow ${isDragging ? "opacity-50" : ""}`}
    >
      <p className="text-xs text-ct-muted font-mono mb-1">#{issue.number}</p>
      <p className="text-sm font-medium text-ct-navy leading-snug">{issue.title}</p>
      <div className="flex items-center gap-1.5 mt-2">
        <span className={`size-2 rounded-full ${PRIORITY_DOT[issue.priority] ?? PRIORITY_DOT.no_priority}`} />
        <span className="text-[10px] text-ct-muted capitalize">{issue.priority.replace("_", " ")}</span>
      </div>
    </div>
  );
}

function BoardColumn({ status, issues, onCardClick }: { status: IssueStatus; issues: Issue[]; onCardClick: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });

  return (
    <div className="flex-1 min-w-[260px]">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-sm font-semibold text-ct-navy">{status.name}</h3>
        <span className="text-xs text-ct-muted bg-ct-cloud rounded-full px-2 py-0.5">{issues.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`rounded-xl p-2 min-h-[400px] transition-colors ${isOver ? "bg-ct-accent/40" : "bg-ct-cloud/50"}`}
      >
        {issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} onClick={() => onCardClick(issue.id)} />
        ))}
      </div>
    </div>
  );
}

export default function BoardPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [projectName, setProjectName] = useState("");
  const [issuePrefix, setIssuePrefix] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [statuses, setStatuses] = useState<IssueStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [projectRes, issuesRes, statusesRes] = await Promise.all([
        fetch(`/api/projects/${projectId}`),
        fetch(`/api/pms/issues?projectId=${projectId}`),
        fetch(`/api/pms/issue-statuses?projectId=${projectId}`),
      ]);
      const [project, issuesData, statusesData] = await Promise.all([
        projectRes.json(), issuesRes.json(), statusesRes.json(),
      ]);
      setProjectName(project.name ?? "Project");
      setIssuePrefix(project.issuePrefix ?? null);
      setIssues(issuesData.issues ?? []);
      setStatuses((statusesData.issueStatuses ?? []).sort((a: IssueStatus, b: IssueStatus) => a.position - b.position));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const issuesByStatus = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const status of statuses) map.set(status.id, []);
    for (const issue of issues) map.get(issue.statusId)?.push(issue);
    return map;
  }, [issues, statuses]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const issueId = active.id as string;
    const newStatusId = over.id as string;
    const issue = issues.find((i) => i.id === issueId);
    if (!issue || issue.statusId === newStatusId) return;

    setIssues((prev) => prev.map((i) => (i.id === issueId ? { ...i, statusId: newStatusId } : i)));
    try {
      const res = await fetch(`/api/pms/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusId: newStatusId }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Failed to move issue");
      load();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <ProjectNav projectId={projectId} projectName={projectName} />
        <CreateIssueDialog projectId={projectId} onCreated={load} />
      </div>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <DndContext onDragEnd={handleDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {statuses.map((status) => (
              <BoardColumn
                key={status.id}
                status={status}
                issues={issuesByStatus.get(status.id) ?? []}
                onCardClick={setSelectedIssueId}
              />
            ))}
          </div>
        </DndContext>
      )}

      <IssueDetailPanel
        issueId={selectedIssueId}
        projectId={projectId}
        issuePrefix={issuePrefix}
        onClose={() => setSelectedIssueId(null)}
        onUpdated={load}
      />
    </div>
  );
}
