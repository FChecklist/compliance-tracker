"use client";

export const dynamic = "force-dynamic";

// Wave 6 batch 1 (compliance-tracker/PROJEXA merge, module-mapping report
// finding GAP-CONSTR): Requests for Information, ported from PROJEXA's own
// RfisClient.tsx (same construction-field-workflow-service.ts backend as
// submittals/punch-list, /api/v1/projexa/rfis) onto this repo's own list+
// dialog+ProjectPicker shell. Status-filter added on top of PROJEXA's own
// reference page (which had none) since a 500-project firm's RFI log per
// project won't stay browsable as a single unfiltered list.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, HelpCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type Rfi = {
  id: string; number: number; subject: string; question: string; status: string;
  ballInCourt: string; answer: string | null; dueDate: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  answered: "bg-ct-saffron/20 text-ct-saffron",
  closed: "bg-green-100 text-green-700",
};

export default function RfisPage() {
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [rfis, setRfis] = useState<Rfi[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [question, setQuestion] = useState("");
  const [creating, setCreating] = useState(false);

  const [answering, setAnswering] = useState<Rfi | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
      const params = new URLSearchParams({ projectId });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/v1/projexa/rfis?${params.toString()}`);
      const data = await res.json();
      setRfis(data.rfis ?? []);
    } catch {
      toast.error("Failed to load RFIs");
    } finally {
      setLoading(false);
    }
  }, [projectId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const createRfi = async () => {
    if (!projectId || !subject.trim() || !question.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/projexa/rfis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, subject, question }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("RFI created");
      setOpen(false);
      setSubject(""); setQuestion("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to create RFI");
    } finally {
      setCreating(false);
    }
  };

  const submitAnswer = async () => {
    if (!answering || !answerText.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/projexa/rfis/${answering.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer", answer: answerText }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("RFI answered");
      setAnswering(null); setAnswerText("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to answer RFI");
    } finally {
      setSubmitting(false);
    }
  };

  const closeRfi = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/projexa/rfis/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("RFI closed");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to close RFI");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">RFIs</h1>
          <p className="text-sm text-ct-muted mt-1">Requests for Information -- raise a question, track who has the ball, close once answered.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
              <Plus className="size-4 mr-1" /> New RFI
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New RFI</DialogTitle><DialogDescription>Raised against the selected project.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Subject</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Beam reinforcement detail at grid C4" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Question</Label>
                <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={4} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createRfi} disabled={creating || !subject.trim() || !question.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create RFI
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={HelpCircle} />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="answered">Answered</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : rfis.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No RFIs yet.</CardContent></Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead><TableHead>Subject</TableHead><TableHead>Ball in Court</TableHead>
                      <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rfis.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs text-ct-muted">RFI-{r.number}</TableCell>
                        <TableCell className="font-medium text-ct-navy">{r.subject}</TableCell>
                        <TableCell className="capitalize text-ct-muted">{r.ballInCourt}</TableCell>
                        <TableCell><Badge className={`text-xs border-0 ${STATUS_COLORS[r.status] ?? "bg-ct-cloud text-ct-muted"}`}>{r.status}</Badge></TableCell>
                        <TableCell className="text-right">
                          {r.status === "open" && (
                            <Button size="sm" variant="outline" onClick={() => { setAnswering(r); setAnswerText(""); }}>Answer</Button>
                          )}
                          {r.status === "answered" && (
                            <Button size="sm" variant="outline" onClick={() => closeRfi(r.id)}>Close</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={!!answering} onOpenChange={(v) => !v && setAnswering(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Answer: {answering?.subject}</DialogTitle></DialogHeader>
          <p className="text-sm text-ct-muted">{answering?.question}</p>
          <Textarea value={answerText} onChange={(e) => setAnswerText(e.target.value)} rows={4} placeholder="Your answer..." />
          <DialogFooter>
            <Button onClick={submitAnswer} disabled={submitting || !answerText.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Submit Answer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
