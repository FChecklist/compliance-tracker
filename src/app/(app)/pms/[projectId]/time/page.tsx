"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, Clock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import ProjectNav from "@/components/pms/ProjectNav";

type TimeEntry = {
  id: string;
  hours: string;
  spentOn: string;
  comments: string | null;
  issue: { id: string; number: number; title: string } | null;
};
type Issue = { id: string; number: number; title: string };

export default function TimeTrackingPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [projectName, setProjectName] = useState("");
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [issueId, setIssueId] = useState("");
  const [hours, setHours] = useState("");
  const [spentOn, setSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [comments, setComments] = useState("");
  const [logging, setLogging] = useState(false);

  const load = useCallback(async () => {
    const [projectRes, entriesRes, issuesRes] = await Promise.all([
      fetch(`/api/projects/${projectId}`),
      fetch(`/api/pms/time-entries?projectId=${projectId}`),
      fetch(`/api/pms/issues?projectId=${projectId}`),
    ]);
    const [project, entriesData, issuesData] = await Promise.all([projectRes.json(), entriesRes.json(), issuesRes.json()]);
    setProjectName(project.name ?? "Project");
    setEntries(entriesData.timeEntries ?? []);
    setIssues(issuesData.issues ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);

  const logTime = async () => {
    if (!issueId || !hours) return;
    setLogging(true);
    try {
      const res = await fetch("/api/pms/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId, hours, spentOn, comments }),
      });
      if (!res.ok) throw new Error();
      toast.success("Time logged");
      setOpen(false);
      setHours("");
      setComments("");
      load();
    } catch {
      toast.error("Failed to log time");
    } finally {
      setLogging(false);
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
              Log Time
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Log Time</DialogTitle>
              <DialogDescription>Record time spent on an issue.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Issue</Label>
                <Select value={issueId} onValueChange={setIssueId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select an issue" /></SelectTrigger>
                  <SelectContent>
                    {issues.map((i) => <SelectItem key={i.id} value={i.id}>#{i.number} {i.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Hours</Label>
                  <Input type="number" step="0.25" min="0" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="2.5" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Date</Label>
                  <Input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Comments</Label>
                <Input value={comments} onChange={(e) => setComments(e.target.value)} placeholder="What did you work on?" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={logTime} disabled={logging || !issueId || !hours} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {logging ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Log Time
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2 text-sm text-ct-muted">
        <Clock className="size-4" />
        {totalHours.toFixed(2)} hours logged total
      </div>

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-ct-muted py-10 text-center">No time logged yet.</p>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead className="w-24">Hours</TableHead>
                <TableHead>Comments</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-sm text-ct-muted">{entry.spentOn}</TableCell>
                  <TableCell className="text-sm text-ct-navy">{entry.issue ? `#${entry.issue.number} ${entry.issue.title}` : "—"}</TableCell>
                  <TableCell className="text-sm font-medium">{Number(entry.hours).toFixed(2)}</TableCell>
                  <TableCell className="text-sm text-ct-muted">{entry.comments ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
