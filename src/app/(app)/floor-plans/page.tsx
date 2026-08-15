"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 6 batch 2 (compliance-tracker/PROJEXA merge, module-mapping report
// finding GAP-CONSTR): floor plan list per project. Backend
// (interior-floorplan-service.ts, Wave 143) fully built. Ported from
// PROJEXA's own FloorPlansClient.tsx onto this repo's own ProjectPicker
// shell. See src/app/(app)/floor-plans/[id]/page.tsx for the real 2D room
// + furniture-placement editor, and that file's own header comment for why
// this wave does NOT ship a 3D walkthrough route (PROJEXA's own walkthrough
// depends on @react-three/fiber/drei/three, none of which are in this
// repo's package.json -- a genuine new-heavy-dependency decision flagged in
// this PR's description, not silently added here).
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, LayoutPanelLeft, Box } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type FloorPlan = { id: string; name: string; floorLevel: string | null; status: string };

export default function FloorPlansPage() {
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [plans, setPlans] = useState<FloorPlan[]>([]);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [floorLevel, setFloorLevel] = useState("");
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
      const res = await fetch(`/api/v1/projexa/floor-plans?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setPlans(data.floorPlans ?? []);
    } catch {
      toast.error("Failed to load floor plans");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const createPlan = async () => {
    if (!projectId || !name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/projexa/floor-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name, floorLevel: floorLevel || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Floor plan created");
      setOpen(false);
      setName(""); setFloorLevel("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to create floor plan");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Floor Plans</h1>
          <p className="text-sm text-ct-muted mt-1">2D room + furniture-placement editor per floor. 3D walkthrough is deferred -- see PR description.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
              <Plus className="size-4 mr-1" /> New Floor Plan
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Floor Plan</DialogTitle><DialogDescription>Created against the selected project.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Living + Dining Layout" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Floor Level (optional)</Label>
                <Input value={floorLevel} onChange={(e) => setFloorLevel(e.target.value)} placeholder="e.g. Ground Floor" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createPlan} disabled={creating || !name.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
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
        <NoProjectsCard icon={LayoutPanelLeft} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : plans.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No floor plans yet for this project.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((p) => (
                <Card key={p.id} className="rounded-xl shadow-card bg-white">
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <div>
                      <CardTitle className="text-base text-ct-navy">{p.name}</CardTitle>
                      {p.floorLevel && <p className="text-xs text-ct-muted mt-0.5">{p.floorLevel}</p>}
                    </div>
                    <Badge className={`text-xs border-0 ${p.status === "final" ? "bg-green-100 text-green-700" : "bg-ct-cloud text-ct-muted"}`}>{p.status}</Badge>
                  </CardHeader>
                  <CardContent className="flex gap-2">
                    <Link href={`/floor-plans/${p.id}`} className="flex-1">
                      <Button variant="outline" className="w-full"><LayoutPanelLeft className="size-4 mr-1.5" /> 2D Editor</Button>
                    </Link>
                    <Button variant="outline" className="flex-1" disabled title="3D walkthrough needs three.js/react-three-fiber -- deferred, see PR description">
                      <Box className="size-4 mr-1.5" /> 3D (deferred)
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
