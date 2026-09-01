"use client";

export const dynamic = "force-dynamic";

// R64/R48 gap-closure (2026-08-30, F076: "Upload drawings and 3D
// walkthrough"). The backend has existed since Wave 143
// (/api/v1/projexa/drawings -- see that route's own header comment: a thin
// alias over document-service.ts's generic documents table, category=
// 'drawing' for an uploaded DWG/PDF file or 'drawing_3d' for a 3D
// walkthrough, which may itself be either an uploaded file OR an external
// share link e.g. Matterport/SketchUp) but no (app) page or sidebar link
// ever called it -- confirmed via memory (R63: "Drawings&3D/Design Studio
// still open, deliberately not faked") and a real PowerShell directory
// listing showing no /drawings folder existed. Built on the exact same
// list+dialog+ProjectPicker shell as the sibling /permits page (same
// backend posture -- Bearer/cookie dual auth via requireAuthOrApiKey, same
// document-service.ts primitive underneath).
import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Box, ExternalLink } from "lucide-react";
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

type Drawing = {
  id: string; name: string; kind: "dwg" | "3d_walkthrough"; discipline: string | null;
  isExternalLink: boolean; fileType: string | null; documentUrl: string | null; createdAt: string;
};

function DrawingsPageInner() {
  // R66 (Design Studio hub): ?projectId= pre-selects the project when
  // arriving from /design-studio's "Open" links -- same
  // useSearchParams-in-Suspense convention as chat/page.tsx and
  // reports/page.tsx's CustomReportsSection.
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get("projectId");

  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"dwg" | "3d_walkthrough">("dwg");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: PickerProject[] = d.projects ?? [];
        setProjects(list);
        if (list.length > 0) {
          const preselect = initialProjectId && list.some((p) => p.id === initialProjectId) ? initialProjectId : list[0].id;
          setProjectId((prev) => prev || preselect);
        }
      })
      .catch(() => toast.error("Failed to load projects"))
      .finally(() => setLoadingProjects(false));
  }, [initialProjectId]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/drawings?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setDrawings(data.drawings ?? []);
    } catch {
      toast.error("Failed to load drawings");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const createDrawing = async () => {
    if (!projectId || !name.trim()) return;
    if (kind === "dwg" && !file) return;
    if (kind === "3d_walkthrough" && !file && !externalUrl.trim()) return;
    setCreating(true);
    try {
      const formData = new FormData();
      formData.set("projectId", projectId);
      formData.set("kind", kind);
      formData.set("name", name);
      if (discipline) formData.set("discipline", discipline);
      if (file) formData.set("file", file);
      if (kind === "3d_walkthrough" && externalUrl.trim()) formData.set("externalUrl", externalUrl.trim());

      const res = await fetch("/api/v1/projexa/drawings", { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success(kind === "dwg" ? "Drawing uploaded" : "3D walkthrough added");
      setOpen(false);
      setFile(null); setName(""); setDiscipline(""); setExternalUrl("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to add drawing");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Drawings &amp; 3D</h1>
          <p className="text-sm text-ct-muted mt-1">Upload DWG/PDF drawings, or add a 3D walkthrough (file or a Matterport/SketchUp share link), per project.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
              <Plus className="size-4 mr-1" /> Add Drawing
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Drawing / 3D Walkthrough</DialogTitle><DialogDescription>Attached to the selected project.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Type</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as "dwg" | "3d_walkthrough")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dwg">DWG / PDF drawing</SelectItem>
                    <SelectItem value="3d_walkthrough">3D walkthrough</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ground Floor Plan -- Rev C" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Discipline (optional)</Label>
                <Input value={discipline} onChange={(e) => setDiscipline(e.target.value)} placeholder="Architectural / Structural / MEP" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">
                  {kind === "dwg" ? "Drawing file" : "File (optional if a share link is given below)"}
                </Label>
                <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
              {kind === "3d_walkthrough" && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Or an external share link</Label>
                  <Input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://my.matterport.com/show/?m=..." />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                onClick={createDrawing}
                disabled={creating || !name.trim() || (kind === "dwg" ? !file : !file && !externalUrl.trim())}
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
              >
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={Box} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : drawings.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No drawings or 3D walkthroughs added for this project yet.</CardContent></Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Discipline</TableHead>
                      <TableHead>Added</TableHead><TableHead className="text-right">Open</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drawings.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium text-ct-navy">{d.name}</TableCell>
                        <TableCell>
                          {d.kind === "3d_walkthrough" ? (
                            <Badge className="text-xs border-0 bg-ct-saffron/20 text-ct-saffron">3D Walkthrough</Badge>
                          ) : (
                            <Badge className="text-xs border-0 bg-ct-cloud text-ct-muted">Drawing</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-ct-muted">{d.discipline ?? "--"}</TableCell>
                        <TableCell className="text-ct-muted">{new Date(d.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                          {d.documentUrl ? (
                            <a href={d.documentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-ct-saffron hover:underline">
                              Open <ExternalLink className="size-3" />
                            </a>
                          ) : "--"}
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

export default function DrawingsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-ct-muted">Loading...</div>}>
      <DrawingsPageInner />
    </Suspense>
  );
}
