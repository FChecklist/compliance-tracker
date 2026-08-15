"use client";

export const dynamic = "force-dynamic";

// Wave 6 batch 1 (compliance-tracker/PROJEXA merge, module-mapping report
// finding GAP-CONSTR, highest-value item in the batch): Bill of Quantities
// / Scope of Work list, calling /api/construction/boq directly (the native
// route construction-boq-service.ts backs -- /api/v1/projexa/scope is a
// pure re-export of the same handler for PROJEXA's API-key callers, so
// there is no reason for this repo's own UI to go through the alias).
// PROJEXA's own ScopeClient.tsx (read during this wave's research) only
// covers list+create -- it has no detail page and never calls the
// approve/compare/revisions/submit endpoints despite those being fully
// built server-side, so there was no reference UX to port for the
// workflow. The detail page (./[id]/page.tsx) was designed directly from
// construction-boq-service.ts's contract instead -- see that file's header
// comment for what's covered and what's deliberately left for a follow-up.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Loader2, Plus, Trash2, ClipboardList } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type Boq = { id: string; version: number; title: string; status: string; parentBoqId: string | null; createdAt: string };
type LineItemDraft = { description: string; unit: string; quantity: string; rate: string };

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-ct-cloud text-ct-muted",
  submitted: "bg-ct-saffron/20 text-ct-saffron",
  approved: "bg-green-100 text-green-700",
  superseded: "bg-red-100 text-red-700",
};

const emptyLine = (): LineItemDraft => ({ description: "", unit: "", quantity: "", rate: "" });

export default function ScopePage() {
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [boqs, setBoqs] = useState<Boq[]>([]);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
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
      const res = await fetch(`/api/construction/boq?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setBoqs(data.boqs ?? []);
    } catch {
      toast.error("Failed to load scope of work");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const updateLine = (index: number, field: keyof LineItemDraft, value: string) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };

  const createBoq = async () => {
    if (!projectId || !title.trim()) return;
    const validLines = lines.filter((l) => l.description.trim() && l.unit.trim() && l.quantity && l.rate);
    if (validLines.length === 0) {
      toast.error("Add at least one complete line item");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/construction/boq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, title,
          lineItems: validLines.map((l) => ({ description: l.description, unit: l.unit, quantity: Number(l.quantity), rate: Number(l.rate) })),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("BOQ created");
      setOpen(false);
      setTitle(""); setLines([emptyLine()]);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to create BOQ");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Scope (BOQ)</h1>
          <p className="text-sm text-ct-muted mt-1">Bill of Quantities per project -- draft, submit, approve, and revise with a full comparison against the previous version.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
              <Plus className="size-4 mr-1" /> New BOQ
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New Bill of Quantities</DialogTitle><DialogDescription>Version 1, created as a draft against the selected project.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Civil Works - Phase 1" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Line Items</Label>
                {lines.map((line, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px_90px_100px_28px] gap-2">
                    <Input placeholder="Description" value={line.description} onChange={(e) => updateLine(i, "description", e.target.value)} />
                    <Input placeholder="Unit" value={line.unit} onChange={(e) => updateLine(i, "unit", e.target.value)} />
                    <Input placeholder="Qty" type="number" value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} />
                    <Input placeholder="Rate" type="number" value={line.rate} onChange={(e) => updateLine(i, "rate", e.target.value)} />
                    <Button variant="ghost" size="icon" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
                  <Plus className="size-3.5 mr-1" /> Add Line
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createBoq} disabled={creating || !title.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create BOQ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={ClipboardList} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : boqs.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No BOQs yet for this project.</CardContent></Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Title</TableHead><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {boqs.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium text-ct-navy">{b.title}</TableCell>
                        <TableCell className="text-ct-muted">v{b.version}</TableCell>
                        <TableCell><Badge className={`text-xs border-0 ${STATUS_COLORS[b.status] ?? "bg-ct-cloud text-ct-muted"}`}>{b.status}</Badge></TableCell>
                        <TableCell className="text-ct-muted whitespace-nowrap">{new Date(b.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                          <Link href={`/scope/${b.id}`}><Button size="sm" variant="outline" className="h-8 text-xs">Open</Button></Link>
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
    </div>
  );
}
