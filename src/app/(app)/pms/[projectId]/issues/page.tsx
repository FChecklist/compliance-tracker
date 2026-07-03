"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
};

type IssueStatus = { id: string; name: string; group: string };

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-emerald-100 text-emerald-700",
  no_priority: "bg-ct-cloud text-ct-muted",
};

export default function IssueListPage() {
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
      setStatuses(statusesData.issueStatuses ?? []);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const statusName = (statusId: string) => statuses.find((s) => s.id === statusId)?.name ?? "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <ProjectNav projectId={projectId} projectName={projectName} />
        <CreateIssueDialog projectId={projectId} onCreated={load} />
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : issues.length === 0 ? (
        <p className="text-sm text-ct-muted py-10 text-center">No issues yet. Create the first one.</p>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">ID</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-40">Status</TableHead>
                <TableHead className="w-32">Priority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.map((issue) => (
                <TableRow key={issue.id} className="cursor-pointer hover:bg-ct-cloud" onClick={() => setSelectedIssueId(issue.id)}>
                  <TableCell className="font-mono text-xs text-ct-muted">{issuePrefix ?? "ISSUE"}-{issue.number}</TableCell>
                  <TableCell className="font-medium text-ct-navy">{issue.title}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs">{statusName(issue.statusId)}</Badge></TableCell>
                  <TableCell>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${PRIORITY_BADGE[issue.priority] ?? PRIORITY_BADGE.no_priority}`}>
                      {issue.priority.replace("_", " ")}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
