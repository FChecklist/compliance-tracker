"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 6 batch 1 (compliance-tracker/PROJEXA merge, module-mapping report
// finding GAP-CONSTR): daily site-diary log per project. Backend
// (construction-site-diary-service.ts, dual-aliased at
// /api/v1/projexa/site-diary and /api/v1/construction/site-diary) was fully
// built in an earlier PROJEXA-foundation wave -- this page is the first
// (app) UI for it anywhere in compliance-tracker, ported from PROJEXA's own
// SiteDiaryClient.tsx (list+create, no edit/delete -- a diary entry is a
// point-in-time record, matching the one-row-per-project-per-day unique
// constraint enforced server-side) but adapted to this repo's own
// project-selector convention since compliance-tracker has no PROJEXA-style
// URL-based global project switcher.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, NotebookPen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Project = { id: string; name: string };
type Diary = {
  id: string; diaryDate: string; weather: string | null; workDone: string | null;
  visitors: string | null; issues: string | null; instructions: string | null;
  materialReceived: string | null; labourCount: number | null; remarks: string | null;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function SiteDiaryPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [diaries, setDiaries] = useState<Diary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [diaryDate, setDiaryDate] = useState(todayIso);
  const [weather, setWeather] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [visitors, setVisitors] = useState("");
  const [labourCount, setLabourCount] = useState("");
  const [materialReceived, setMaterialReceived] = useState("");
  const [issues, setIssues] = useState("");
  const [instructions, setInstructions] = useState("");
  const [remarks, setRemarks] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: Project[] = d.projects ?? [];
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
      const res = await fetch(`/api/v1/projexa/site-diary?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setDiaries(data.diaries ?? []);
    } catch {
      toast.error("Failed to load site diary");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setDiaryDate(todayIso()); setWeather(""); setWorkDone(""); setVisitors("");
    setLabourCount(""); setMaterialReceived(""); setIssues(""); setInstructions(""); setRemarks("");
  };

  const createDiary = async () => {
    if (!projectId || !diaryDate) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/projexa/site-diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, diaryDate, weather: weather || undefined, workDone: workDone || undefined,
          visitors: visitors || undefined, labourCount: labourCount ? Number(labourCount) : undefined,
          materialReceived: materialReceived || undefined, issues: issues || undefined,
          instructions: instructions || undefined, remarks: remarks || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Diary entry saved");
      setOpen(false);
      resetForm();
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to save diary entry");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Site Diary</h1>
          <p className="text-sm text-ct-muted mt-1">Daily site-log entries per project -- weather, work done, visitors, issues and instructions, one entry per project per day.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
              <Plus className="size-4 mr-1" /> New Entry
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Site Diary Entry</DialogTitle><DialogDescription>One entry per project per day.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Date</Label>
                  <Input type="date" value={diaryDate} onChange={(e) => setDiaryDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Weather</Label>
                  <Input value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="e.g. Clear, 28C" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Work Done</Label>
                <Textarea value={workDone} onChange={(e) => setWorkDone(e.target.value)} rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Labour Count</Label>
                  <Input type="number" value={labourCount} onChange={(e) => setLabourCount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Visitors (optional)</Label>
                  <Input value={visitors} onChange={(e) => setVisitors(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Material Received (optional)</Label>
                <Input value={materialReceived} onChange={(e) => setMaterialReceived(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Issues (optional)</Label>
                <Textarea value={issues} onChange={(e) => setIssues(e.target.value)} rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Instructions (optional)</Label>
                <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Remarks (optional)</Label>
                <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createDiary} disabled={creating || !diaryDate} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Save Entry
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center space-y-2"><NotebookPen className="size-10 text-ct-muted mx-auto" /><p className="text-sm text-ct-muted">No projects yet -- create a project first.</p></CardContent></Card>
      ) : (
        <>
          <div className="max-w-xs">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Choose a project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : diaries.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No diary entries yet for this project.</CardContent></Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead><TableHead>Weather</TableHead><TableHead>Work Done</TableHead>
                      <TableHead>Labour</TableHead><TableHead>Issues</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {diaries.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="text-ct-muted whitespace-nowrap">{new Date(d.diaryDate).toLocaleDateString()}</TableCell>
                        <TableCell>{d.weather ?? "--"}</TableCell>
                        <TableCell className="max-w-xs truncate">{d.workDone ?? "--"}</TableCell>
                        <TableCell>{d.labourCount ?? "--"}</TableCell>
                        <TableCell className="max-w-xs truncate text-ct-muted">{d.issues ?? "--"}</TableCell>
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
