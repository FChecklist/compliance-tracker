"use client";

export const dynamic = "force-dynamic";

// R63/Sumeet-modules gap-closure (2026-08-29): Priority 16 Part 2's own
// header comment already documented this exact gap ("PROJEXA's Schedule
// module had a fully working backend ... but zero route/UI path to reach
// it") -- confirmed again here via a real local browser walkthrough
// (direct nav to /schedule 404'd, no sidebar link existed). This is a thin
// list+create UI over the existing pms-issue-service.ts backend
// (/api/v1/projexa/schedule), same shell pattern as the sibling /rfis page.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, CalendarClock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type Task = {
  id: string; number: number; title: string; description: string | null;
  priority: string; statusId: string; dueDate: string | null; startDate: string | null;
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-ct-saffron/20 text-ct-saffron",
  low: "bg-ct-cloud text-ct-muted",
  no_priority: "bg-ct-cloud text-ct-muted",
};

export default function SchedulePage() {
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const [creating, setCreating] = useState(false);

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
      const res = await fetch(`/api/v1/projexa/schedule?${new URLSearchParams({ projectId }).toString()}`);
      const data = await res.json();
      setTasks(data.tasks ?? []);
    } catch {
      toast.error("Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const createTask = async () => {
    if (!projectId || !title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/projexa/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, title, description: description || undefined, priority,
          startDate: startDate || undefined, dueDate: dueDate || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Schedule item created");
      setOpen(false);
      setTitle(""); setDescription(""); setStartDate(""); setDueDate(""); setPriority("medium");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to create schedule item");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Schedule</h1>
          <p className="text-sm text-ct-muted mt-1">Project schedule -- tasks with start/due dates and priority, per project.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
              <Plus className="size-4 mr-1" /> New Task
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Schedule Task</DialogTitle><DialogDescription>Added to the selected project&apos;s schedule.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pour foundation slab -- Block C" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Start date</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Due date</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createTask} disabled={creating || !title.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create Task
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={CalendarClock} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : tasks.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No schedule items for this project yet.</CardContent></Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead><TableHead>Title</TableHead><TableHead>Priority</TableHead>
                      <TableHead>Start</TableHead><TableHead>Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs text-ct-muted">#{t.number}</TableCell>
                        <TableCell className="font-medium text-ct-navy">{t.title}</TableCell>
                        <TableCell><Badge className={`text-xs border-0 ${PRIORITY_COLORS[t.priority] ?? "bg-ct-cloud text-ct-muted"}`}>{t.priority.replace("_", " ")}</Badge></TableCell>
                        <TableCell className="text-ct-muted">{t.startDate ? new Date(t.startDate).toLocaleDateString() : "--"}</TableCell>
                        <TableCell className="text-ct-muted">{t.dueDate ? new Date(t.dueDate).toLocaleDateString() : "--"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
