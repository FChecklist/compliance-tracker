"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, CheckCircle2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import ProjectNav from "@/components/pms/ProjectNav";

type Sprint = {
  id: string;
  name: string;
  goal: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  progressSnapshot: { total: number; completed: number; cancelled: number; remaining: number } | null;
};
type Issue = { id: string; number: number; title: string };

const STATUS_BADGE: Record<string, string> = {
  planned: "bg-ct-cloud text-ct-muted",
  active: "bg-emerald-100 text-emerald-700",
  completed: "bg-blue-100 text-blue-700",
  cancelled: "bg-red-100 text-red-700",
};

export default function SprintsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [projectName, setProjectName] = useState("");
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [allIssues, setAllIssues] = useState<Issue[]>([]);
  const [sprintIssues, setSprintIssues] = useState<Record<string, Issue[]>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [creating, setCreating] = useState(false);
  const [addIssueSprintId, setAddIssueSprintId] = useState<string | null>(null);
  const [pickedIssueId, setPickedIssueId] = useState("");

  const load = useCallback(async () => {
    const [projectRes, sprintsRes, issuesRes] = await Promise.all([
      fetch(`/api/projects/${projectId}`),
      fetch(`/api/pms/sprints?projectId=${projectId}`),
      fetch(`/api/pms/issues?projectId=${projectId}`),
    ]);
    const [project, sprintsData, issuesData] = await Promise.all([projectRes.json(), sprintsRes.json(), issuesRes.json()]);
    setProjectName(project.name ?? "Project");
    const sprintList: Sprint[] = sprintsData.sprints ?? [];
    setSprints(sprintList);
    setAllIssues(issuesData.issues ?? []);

    const entries = await Promise.all(
      sprintList.map(async (s) => {
        const r = await fetch(`/api/pms/sprints/${s.id}/issues`);
        const d = await r.json();
        return [s.id, d.issues ?? []] as const;
      })
    );
    setSprintIssues(Object.fromEntries(entries));
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const createSprint = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/pms/sprints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name, goal }),
      });
      if (!res.ok) throw new Error();
      toast.success("Sprint created");
      setOpen(false);
      setName("");
      setGoal("");
      load();
    } catch {
      toast.error("Failed to create sprint");
    } finally {
      setCreating(false);
    }
  };

  const closeSprint = async (sprintId: string) => {
    try {
      const res = await fetch(`/api/pms/sprints/${sprintId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      if (!res.ok) throw new Error();
      toast.success("Sprint closed");
      load();
    } catch {
      toast.error("Failed to close sprint");
    }
  };

  const startSprint = async (sprintId: string) => {
    try {
      const res = await fetch(`/api/pms/sprints/${sprintId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) throw new Error();
      toast.success("Sprint started");
      load();
    } catch {
      toast.error("Failed to start sprint");
    }
  };

  const addIssue = async (sprintId: string) => {
    if (!pickedIssueId) return;
    try {
      const res = await fetch(`/api/pms/sprints/${sprintId}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId: pickedIssueId }),
      });
      if (!res.ok) throw new Error();
      setAddIssueSprintId(null);
      setPickedIssueId("");
      load();
    } catch {
      toast.error("Failed to add issue to sprint");
    }
  };

  const removeIssue = async (sprintId: string, issueId: string) => {
    try {
      const res = await fetch(`/api/pms/sprints/${sprintId}/issues?issueId=${issueId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Failed to remove issue from sprint");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <ProjectNav projectId={projectId} projectName={projectName} />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              <Plus className="size-4 mr-2" />
              New Sprint
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Sprint</DialogTitle>
              <DialogDescription>Create a new time-boxed sprint.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 1" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Goal</Label>
                <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What are we trying to achieve this sprint?" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createSprint} disabled={creating || !name.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create Sprint
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : sprints.length === 0 ? (
        <p className="text-sm text-ct-muted py-10 text-center">No sprints yet. Create the first one.</p>
      ) : (
        <div className="space-y-4">
          {sprints.map((sprint) => {
            const issues = sprintIssues[sprint.id] ?? [];
            return (
              <Card key={sprint.id} className="rounded-xl shadow-card bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold text-ct-navy flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      {sprint.name}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[sprint.status] ?? STATUS_BADGE.planned}`}>
                        {sprint.status}
                      </span>
                    </span>
                    {sprint.status === "planned" && (
                      <Button size="sm" variant="outline" onClick={() => startSprint(sprint.id)}>
                        Start Sprint
                      </Button>
                    )}
                    {sprint.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => closeSprint(sprint.id)}>
                        <CheckCircle2 className="size-3.5 mr-1.5" />
                        Close Sprint
                      </Button>
                    )}
                  </CardTitle>
                  {sprint.goal && <p className="text-sm text-ct-muted">{sprint.goal}</p>}
                </CardHeader>
                <CardContent className="space-y-2">
                  {sprint.progressSnapshot && (
                    <p className="text-xs text-ct-muted">
                      {sprint.progressSnapshot.completed} completed, {sprint.progressSnapshot.cancelled} cancelled, {sprint.progressSnapshot.remaining} remaining (of {sprint.progressSnapshot.total})
                    </p>
                  )}
                  {issues.map((issue) => (
                    <div key={issue.id} className="flex items-center justify-between text-sm py-1 border-b border-ct-border last:border-0">
                      <span className="text-ct-navy">#{issue.number} {issue.title}</span>
                      <button onClick={() => removeIssue(sprint.id, issue.id)} className="text-ct-muted hover:text-red-600">
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  {addIssueSprintId === sprint.id ? (
                    <div className="flex items-center gap-2 pt-2">
                      <Select value={pickedIssueId} onValueChange={setPickedIssueId}>
                        <SelectTrigger className="h-8 flex-1"><SelectValue placeholder="Select an issue" /></SelectTrigger>
                        <SelectContent>
                          {allIssues.filter((i) => !issues.some((si) => si.id === i.id)).map((i) => (
                            <SelectItem key={i.id} value={i.id}>#{i.number} {i.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" onClick={() => addIssue(sprint.id)}>Add</Button>
                      <Button size="sm" variant="ghost" onClick={() => setAddIssueSprintId(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setAddIssueSprintId(sprint.id)} className="mt-2">
                      <Plus className="size-3.5 mr-1.5" />
                      Add Issue
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
