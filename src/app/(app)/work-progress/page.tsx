"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 6 batch 2 (compliance-tracker/PROJEXA merge, module-mapping report
// finding GAP-CONSTR): physical progress-activity logging per project.
// Backend (construction-progress-service.ts, Wave 115 + Priority 16 Part 2's
// activity-picker fix) fully built. Log-entry + activity-picker UI ported
// from PROJEXA's own WorkProgressClient.tsx (Category->Activity picker with
// an inline "create the first one" escape hatch for brand-new projects,
// since a fresh project has zero activities and the API auto-provisions a
// "General" category on first activity create -- see
// /api/v1/projexa/work-progress/activities' own route comment).
//
// AI photo-progress estimation is a genuine addition on top of PROJEXA's
// own reference page -- confirmed by grep across PROJEXA's entire source
// tree that it never wired estimate-progress/progress-summary into any UI
// despite construction-ai-service.ts fully supporting both (same "zero UI
// exists anywhere" situation as scope/[id]'s BOQ workflow in batch 1).
// Designed directly from the route contract:
//   - POST /api/v1/projexa/ai/estimate-progress takes {documentId,
//     activityName} only -- the route downloads the image from storage
//     itself server-side and computes imageBase64 there; the client never
//     re-sends image bytes on this call (unlike the fm-register-
//     digitization reference pattern this page's upload step borrows,
//     which does send imageBase64 for its own separate OCR call). A
//     document must exist first, so this page uploads via the existing
//     POST /api/documents (category "site_photo", linked to this project)
//     before calling the AI route -- the same real upload path every other
//     document-backed feature in this repo uses, not a new storage path.
//   - Uploading as category "site_photo" linked to this project also feeds
//     construction-dashboard-service.ts's photoCount metric for free (it
//     counts documents with exactly that category/link), so this isn't a
//     throwaway upload.
//   - GET /api/v1/projexa/ai/progress-summary requires a real user session
//     (requireAuth, not requireAuthOrApiKey) per that route's own comment
//     -- this page is itself only ever loaded in a real session, so no
//     special-casing needed, but a 400 here reads as "no AI model
//     configured for this org" via the toast, not a silent failure.
import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Loader2, Plus, ClipboardList, Camera, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type Entry = {
  id: string; activityId: string; entryDate: string; quantityDone: string;
  percentComplete: number; remarks: string | null;
};
type Activity = { id: string; name: string; unit: string | null };
type ProgressSummary = { summary: string; highlights: string[]; concerns: string[] };
type ProgressEstimate = { estimatedPercentComplete: number; reasoning: string; confidence: "low" | "medium" | "high" };

function progressColor(pct: number) {
  if (pct >= 100) return "bg-green-100 text-green-700";
  if (pct >= 50) return "bg-ct-saffron/20 text-ct-saffron";
  return "bg-ct-cloud text-ct-muted";
}

export default function WorkProgressPage() {
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const activitiesById = new Map(activities.map((a) => [a.id, a]));

  const [open, setOpen] = useState(false);
  const [activityId, setActivityId] = useState("");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quantityDone, setQuantityDone] = useState("");
  const [percentComplete, setPercentComplete] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [newActivityOpen, setNewActivityOpen] = useState(false);
  const [newActivityName, setNewActivityName] = useState("");
  const [newActivityUnit, setNewActivityUnit] = useState("");
  const [creatingActivity, setCreatingActivity] = useState(false);

  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiActivityName, setAiActivityName] = useState("");
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiStep, setAiStep] = useState<"pick" | "uploading" | "estimating" | "done">("pick");
  const [aiEstimate, setAiEstimate] = useState<ProgressEstimate | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const res = await fetch(`/api/v1/projexa/work-progress?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      toast.error("Failed to load work progress");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadActivities = useCallback(async () => {
    if (!projectId) return;
    setActivitiesLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/work-progress/activities?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      const loaded: Activity[] = data.activities ?? [];
      setActivities(loaded);
      setActivityId((prev) => (loaded.some((a) => a.id === prev) ? prev : (loaded[0]?.id ?? "")));
    } catch {
      toast.error("Failed to load activities");
    } finally {
      setActivitiesLoading(false);
    }
  }, [projectId]);

  const loadSummary = useCallback(async () => {
    if (!projectId) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await fetch(`/api/v1/projexa/ai/progress-summary?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setSummary(data);
    } catch (err) {
      setSummary(null);
      setSummaryError(err instanceof Error && err.message ? err.message : "AI summary unavailable");
    } finally {
      setSummaryLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadActivities(); }, [loadActivities]);
  useEffect(() => { setSummary(null); setSummaryError(null); }, [projectId]);

  const createEntry = async () => {
    if (!projectId || !activityId || !entryDate || quantityDone === "" || percentComplete === "") return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/work-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, activityId, entryDate,
          quantityDone: Number(quantityDone), percentComplete: Number(percentComplete),
          remarks: remarks || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Progress logged");
      setQuantityDone(""); setPercentComplete(""); setRemarks(""); setOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to log progress");
    } finally {
      setSubmitting(false);
    }
  };

  const createActivity = async () => {
    if (!projectId || !newActivityName.trim()) return;
    setCreatingActivity(true);
    try {
      const res = await fetch("/api/v1/projexa/work-progress/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name: newActivityName.trim(), unit: newActivityUnit || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create activity");
      toast.success("Activity created");
      setNewActivityName(""); setNewActivityUnit(""); setNewActivityOpen(false);
      await loadActivities();
      setActivityId(data.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create activity");
    } finally {
      setCreatingActivity(false);
    }
  };

  const runAiEstimate = async () => {
    if (!aiFile || !aiActivityName.trim()) return;
    setAiStep("uploading");
    try {
      const formData = new FormData();
      formData.append("file", aiFile);
      formData.append("category", "site_photo");
      formData.append("linkedEntityType", "project");
      formData.append("linkedEntityId", projectId);
      const uploadRes = await fetch("/api/documents", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || "Upload failed");

      setAiStep("estimating");
      const estRes = await fetch("/api/v1/projexa/ai/estimate-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: uploadData.id, activityName: aiActivityName }),
      });
      const estData = await estRes.json();
      if (!estRes.ok) throw new Error(estData.error || "Estimation failed");
      setAiEstimate(estData);
      setAiStep("done");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI progress estimation failed");
      setAiStep("pick");
    }
  };

  const resetAiDialog = () => {
    setAiOpen(false); setAiActivityName(""); setAiFile(null); setAiStep("pick"); setAiEstimate(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const applyAiEstimate = () => {
    if (!aiEstimate) return;
    setPercentComplete(String(aiEstimate.estimatedPercentComplete));
    if (aiActivityName) setRemarks((prev) => prev || `AI photo estimate: ${aiEstimate.reasoning}`);
    resetAiDialog();
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Work Progress</h1>
          <p className="text-sm text-ct-muted mt-1">Daily physical progress against project activities, plus AI photo-based progress estimation.</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={aiOpen} onOpenChange={(v) => (v ? setAiOpen(true) : resetAiDialog())}>
            <DialogTrigger asChild>
              <Button variant="outline" disabled={!projectId}>
                <Camera className="size-4 mr-1.5" /> Estimate from Photo
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>AI Progress Estimate from Photo</DialogTitle><DialogDescription>Upload a site photo and describe the activity -- AI estimates percent complete from the image.</DialogDescription></DialogHeader>
              {aiStep === "done" && aiEstimate ? (
                <div className="space-y-3 py-2">
                  <div className="rounded-lg border border-ct-saffron/40 bg-ct-saffron/10 p-3 space-y-1.5">
                    <p className="text-sm font-semibold text-ct-navy">Estimated: {aiEstimate.estimatedPercentComplete}% complete</p>
                    <p className="text-xs text-ct-muted">Confidence: {aiEstimate.confidence}</p>
                    <p className="text-xs text-ct-navy">{aiEstimate.reasoning}</p>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={resetAiDialog}>Discard</Button>
                    <Button onClick={applyAiEstimate} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">Use in Log Entry</Button>
                  </DialogFooter>
                </div>
              ) : (
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Activity Description</Label>
                    <Input value={aiActivityName} onChange={(e) => setAiActivityName(e.target.value)} placeholder="e.g. Column casting - Level 3" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Site Photo</Label>
                    <Input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => setAiFile(e.target.files?.[0] ?? null)} />
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={runAiEstimate}
                      disabled={!aiFile || !aiActivityName.trim() || aiStep === "uploading" || aiStep === "estimating"}
                      className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
                    >
                      {aiStep === "uploading" || aiStep === "estimating" ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Sparkles className="size-4 mr-2" />}
                      {aiStep === "uploading" ? "Uploading..." : aiStep === "estimating" ? "Estimating..." : "Estimate"}
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
                <Plus className="size-4 mr-1" /> Log Progress
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Log Work Progress</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Activity</Label>
                  {activitiesLoading ? (
                    <div className="flex h-9 items-center gap-2 text-xs text-ct-muted"><Loader2 className="size-3.5 animate-spin" /> Loading activities...</div>
                  ) : activities.length === 0 ? (
                    <p className="text-xs text-ct-muted">
                      No activities yet for this project.{" "}
                      <button type="button" className="font-medium text-ct-navy underline" onClick={() => setNewActivityOpen(true)}>
                        Create the first one
                      </button>.
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      <Select value={activityId} onValueChange={setActivityId}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="Select an activity" /></SelectTrigger>
                        <SelectContent>
                          {activities.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}{a.unit ? ` (${a.unit})` : ""}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="outline" size="icon" onClick={() => setNewActivityOpen(true)} title="New activity">
                        <Plus className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Date</Label>
                  <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Quantity Done</Label>
                    <Input type="number" value={quantityDone} onChange={(e) => setQuantityDone(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">% Complete</Label>
                    <Input type="number" min={0} max={100} value={percentComplete} onChange={(e) => setPercentComplete(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Remarks (optional)</Label>
                  <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={createEntry} disabled={submitting || !activityId} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                  {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                  Log Entry
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={newActivityOpen} onOpenChange={setNewActivityOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>New Activity</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                  <Input value={newActivityName} onChange={(e) => setNewActivityName(e.target.value)} placeholder="e.g. Column casting - Level 3" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Unit (optional)</Label>
                  <Input value={newActivityUnit} onChange={(e) => setNewActivityUnit(e.target.value)} placeholder="e.g. cum, sqm, nos" />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={createActivity} disabled={creatingActivity || !newActivityName.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                  {creatingActivity ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                  Create Activity
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={ClipboardList} />
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
            <Button size="sm" variant="outline" onClick={loadSummary} disabled={summaryLoading}>
              {summaryLoading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Sparkles className="size-3.5 mr-1.5" />}
              AI Progress Summary
            </Button>
          </div>

          {summaryError && (
            <Card className="rounded-xl border border-ct-saffron/40 bg-ct-saffron/10"><CardContent className="pt-4 text-sm text-ct-saffron">{summaryError}</CardContent></Card>
          )}
          {summary && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardHeader><CardTitle className="text-base text-ct-navy flex items-center gap-1.5"><Sparkles className="size-4" /> AI Progress Summary</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-ct-navy">{summary.summary}</p>
                {summary.highlights.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-ct-muted uppercase mb-1">Highlights</p>
                    <ul className="text-sm text-ct-navy list-disc list-inside space-y-0.5">
                      {summary.highlights.map((h, i) => <li key={i}>{h}</li>)}
                    </ul>
                  </div>
                )}
                {summary.concerns.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-ct-muted uppercase mb-1">Concerns</p>
                    <ul className="text-sm text-red-700 list-disc list-inside space-y-0.5">
                      {summary.concerns.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : entries.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No progress entries logged yet.</CardContent></Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead><TableHead>Activity</TableHead><TableHead>Qty Done</TableHead>
                      <TableHead>% Complete</TableHead><TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-ct-muted whitespace-nowrap">{new Date(e.entryDate).toLocaleDateString()}</TableCell>
                        <TableCell className="text-ct-navy">{activitiesById.get(e.activityId)?.name ?? <span className="font-mono text-xs">{e.activityId}</span>}</TableCell>
                        <TableCell>{e.quantityDone}</TableCell>
                        <TableCell><Badge className={`text-xs border-0 ${progressColor(e.percentComplete)}`}>{e.percentComplete}%</Badge></TableCell>
                        <TableCell className="max-w-xs truncate text-ct-muted">{e.remarks ?? "--"}</TableCell>
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
