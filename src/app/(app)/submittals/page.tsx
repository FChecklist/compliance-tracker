"use client";

export const dynamic = "force-dynamic";

// Wave 6 batch 1 (compliance-tracker/PROJEXA merge, module-mapping report
// finding GAP-CONSTR): submittals (shop drawings, product data, samples),
// ported from PROJEXA's own SubmittalsClient.tsx (same
// construction-field-workflow-service.ts backend as rfis/punch-list,
// /api/v1/projexa/submittals) onto this repo's own list+dialog+
// ProjectPicker shell. reviewSubmittal() server-side already rejects a
// reviewer reviewing their own submission (isSelfApproval) -- this page
// doesn't duplicate that check, it just surfaces whatever error the API
// returns via toast.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, FileCheck2 } from "lucide-react";
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

type Submittal = {
  id: string; number: number; title: string; specSection: string | null; type: string;
  status: string; reviewComments: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-ct-cloud text-ct-muted",
  approved: "bg-green-100 text-green-700",
  approved_as_noted: "bg-ct-teal/20 text-ct-teal",
  revise_resubmit: "bg-ct-saffron/20 text-ct-saffron",
  rejected: "bg-red-100 text-red-700",
};

export default function SubmittalsPage() {
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [items, setItems] = useState<Submittal[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [specSection, setSpecSection] = useState("");
  const [creating, setCreating] = useState(false);

  const [reviewing, setReviewing] = useState<Submittal | null>(null);
  const [comments, setComments] = useState("");
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
      const res = await fetch(`/api/v1/projexa/submittals?${params.toString()}`);
      const data = await res.json();
      setItems(data.submittals ?? []);
    } catch {
      toast.error("Failed to load submittals");
    } finally {
      setLoading(false);
    }
  }, [projectId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const createSubmittal = async () => {
    if (!projectId || !title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/projexa/submittals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title, specSection: specSection || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Submittal created");
      setOpen(false);
      setTitle(""); setSpecSection("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to create submittal");
    } finally {
      setCreating(false);
    }
  };

  const review = async (status: string) => {
    if (!reviewing) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/projexa/submittals/${reviewing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review", status, comments: comments || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Submittal reviewed");
      setReviewing(null); setComments("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to review submittal");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Submittals</h1>
          <p className="text-sm text-ct-muted mt-1">Shop drawings, product data and samples awaiting review -- approve, approve-as-noted, revise & resubmit, or reject.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
              <Plus className="size-4 mr-1" /> New Submittal
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Submittal</DialogTitle><DialogDescription>Raised against the selected project.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Structural steel shop drawings - Block A" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Spec Section (optional)</Label>
                <Input value={specSection} onChange={(e) => setSpecSection(e.target.value)} placeholder="e.g. 05 12 00" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createSubmittal} disabled={creating || !title.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={FileCheck2} />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="approved_as_noted">Approved as noted</SelectItem>
                <SelectItem value="revise_resubmit">Revise & resubmit</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : items.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No submittals yet.</CardContent></Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead><TableHead>Title</TableHead><TableHead>Spec Section</TableHead>
                      <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs text-ct-muted">SUB-{s.number}</TableCell>
                        <TableCell className="font-medium text-ct-navy">{s.title}</TableCell>
                        <TableCell className="text-ct-muted">{s.specSection ?? "--"}</TableCell>
                        <TableCell><Badge className={`text-xs border-0 ${STATUS_COLORS[s.status] ?? "bg-ct-cloud text-ct-muted"}`}>{s.status.replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell className="text-right">
                          {s.status === "pending" && (
                            <Button size="sm" variant="outline" onClick={() => { setReviewing(s); setComments(""); }}>Review</Button>
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

      <Dialog open={!!reviewing} onOpenChange={(v) => !v && setReviewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Review: {reviewing?.title}</DialogTitle></DialogHeader>
          <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} placeholder="Review comments (optional)..." />
          <DialogFooter className="flex-wrap gap-2">
            <Button size="sm" onClick={() => review("approved")} disabled={submitting} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">Approve</Button>
            <Button size="sm" variant="outline" onClick={() => review("approved_as_noted")} disabled={submitting}>Approve as Noted</Button>
            <Button size="sm" variant="outline" onClick={() => review("revise_resubmit")} disabled={submitting}>Revise & Resubmit</Button>
            <Button size="sm" variant="destructive" onClick={() => review("rejected")} disabled={submitting}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
