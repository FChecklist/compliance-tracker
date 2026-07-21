"use client";

export const dynamic = "force-dynamic";

// Wave 6 batch 1 (compliance-tracker/PROJEXA merge, module-mapping report
// finding GAP-CONSTR): punch list, ported from PROJEXA's own
// PunchListClient.tsx (same construction-field-workflow-service.ts backend
// as rfis/submittals, /api/v1/projexa/punch-list) onto this repo's own
// list+dialog+ProjectPicker shell. Three-state lifecycle (open ->
// ready_for_review -> verified_closed) mirrors the "don't let the person
// who did the work sign off their own fix" convention the service layer
// enforces server-side (isSelfApproval on verify) -- this page just
// surfaces whatever the API returns.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, ListChecks } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type PunchItem = {
  id: string; number: number; description: string; location: string | null;
  trade: string | null; priority: string; status: string;
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  ready_for_review: "bg-ct-saffron/20 text-ct-saffron",
  verified_closed: "bg-green-100 text-green-700",
};
const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-ct-saffron/20 text-ct-saffron",
  low: "bg-ct-cloud text-ct-muted",
};

export default function PunchListPage() {
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [items, setItems] = useState<PunchItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [trade, setTrade] = useState("");
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
      const params = new URLSearchParams({ projectId });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/v1/projexa/punch-list?${params.toString()}`);
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      toast.error("Failed to load punch list");
    } finally {
      setLoading(false);
    }
  }, [projectId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const createItem = async () => {
    if (!projectId || !description.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/projexa/punch-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, description, location: location || undefined,
          trade: trade || undefined, priority,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Item added");
      setOpen(false);
      setDescription(""); setLocation(""); setTrade(""); setPriority("medium");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to add item");
    } finally {
      setCreating(false);
    }
  };

  const transition = async (id: string, action: "ready" | "verify") => {
    try {
      const res = await fetch(`/api/v1/projexa/punch-list/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to update item");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Punch List</h1>
          <p className="text-sm text-ct-muted mt-1">Closeout defects and outstanding items -- mark done, then an independent verifier signs it off.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
              <Plus className="size-4 mr-1" /> New Item
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Punch List Item</DialogTitle><DialogDescription>Raised against the selected project.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Description</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Touch-up paint on corridor wall, 3rd floor" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Location (optional)</Label>
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Trade (optional)</Label>
                  <Input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="Painting" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createItem} disabled={creating || !description.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Add Item
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={ListChecks} />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="ready_for_review">Ready for review</SelectItem>
                <SelectItem value="verified_closed">Verified closed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : items.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">Nothing on the punch list yet.</CardContent></Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead><TableHead>Description</TableHead><TableHead>Location</TableHead>
                      <TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-mono text-xs text-ct-muted">PL-{i.number}</TableCell>
                        <TableCell className="font-medium text-ct-navy">{i.description}</TableCell>
                        <TableCell className="text-ct-muted">{i.location ?? "--"}</TableCell>
                        <TableCell><Badge className={`text-xs border-0 ${PRIORITY_COLORS[i.priority] ?? "bg-ct-cloud text-ct-muted"}`}>{i.priority}</Badge></TableCell>
                        <TableCell><Badge className={`text-xs border-0 ${STATUS_COLORS[i.status] ?? "bg-ct-cloud text-ct-muted"}`}>{i.status.replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell className="text-right">
                          {i.status === "open" && <Button size="sm" variant="outline" onClick={() => transition(i.id, "ready")}>Mark Done</Button>}
                          {i.status === "ready_for_review" && <Button size="sm" variant="outline" onClick={() => transition(i.id, "verify")}>Verify & Close</Button>}
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
