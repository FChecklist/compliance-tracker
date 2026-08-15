"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 6 batch 2 (compliance-tracker/PROJEXA merge, module-mapping report
// finding GAP-CONSTR): interior-design mood boards per project. Backend
// (interior-design-service.ts, Wave 142) was fully built in an earlier
// PROJEXA-foundation wave -- this page is the first (app) UI for it
// anywhere in compliance-tracker, ported from PROJEXA's own
// MoodBoardsClient.tsx (list + create board + add item + status workflow)
// onto this repo's own ProjectPicker/list-page shell. A mood-board item's
// image lives on the shared `documents` table (documentId, nullable) --
// this port keeps PROJEXA's own label/notes-only item form (no image
// upload wired into the "Add Item" dialog either, matching the reference
// exactly) rather than adding a new upload flow not present in the
// reference page.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Image as ImageIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type MoodBoardItem = { id: string; label: string | null; notes: string | null };
type MoodBoard = { id: string; title: string; roomOrArea: string | null; status: string; items: MoodBoardItem[] };

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-ct-cloud text-ct-muted",
  shared: "bg-ct-saffron/20 text-ct-saffron",
  approved: "bg-green-100 text-green-700",
};

export default function MoodBoardsPage() {
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [boards, setBoards] = useState<MoodBoard[]>([]);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [roomOrArea, setRoomOrArea] = useState("");
  const [creating, setCreating] = useState(false);

  const [addingTo, setAddingTo] = useState<MoodBoard | null>(null);
  const [itemLabel, setItemLabel] = useState("");
  const [itemNotes, setItemNotes] = useState("");
  const [addingItem, setAddingItem] = useState(false);

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
      const res = await fetch(`/api/v1/projexa/mood-boards?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setBoards(data.boards ?? []);
    } catch {
      toast.error("Failed to load mood boards");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const createBoard = async () => {
    if (!projectId || !title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/projexa/mood-boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title, roomOrArea: roomOrArea || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Mood board created");
      setOpen(false);
      setTitle(""); setRoomOrArea("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to create mood board");
    } finally {
      setCreating(false);
    }
  };

  const addItem = async () => {
    if (!addingTo || !itemLabel.trim()) return;
    setAddingItem(true);
    try {
      const res = await fetch(`/api/v1/projexa/mood-boards/${addingTo.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: itemLabel, notes: itemNotes || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Item added");
      setAddingTo(null); setItemLabel(""); setItemNotes("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to add item");
    } finally {
      setAddingItem(false);
    }
  };

  const setStatus = async (board: MoodBoard, status: string) => {
    try {
      const res = await fetch(`/api/v1/projexa/mood-boards/${board.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to update status");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Mood Boards</h1>
          <p className="text-sm text-ct-muted mt-1">Interior-design mood boards per room or area -- collect reference items, share with the client, mark approved.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
              <Plus className="size-4 mr-1" /> New Mood Board
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Mood Board</DialogTitle><DialogDescription>Created against the selected project.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Living Room Concept" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Room / Area (optional)</Label>
                <Input value={roomOrArea} onChange={(e) => setRoomOrArea(e.target.value)} placeholder="e.g. Living Room" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createBoard} disabled={creating || !title.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
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
        <NoProjectsCard icon={ImageIcon} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : boards.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No mood boards yet for this project.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {boards.map((b) => (
                <Card key={b.id} className="rounded-xl shadow-card bg-white">
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <div>
                      <CardTitle className="text-base text-ct-navy">{b.title}</CardTitle>
                      {b.roomOrArea && <p className="text-xs text-ct-muted mt-0.5">{b.roomOrArea}</p>}
                    </div>
                    <Badge className={`text-xs border-0 ${STATUS_COLORS[b.status] ?? "bg-ct-cloud text-ct-muted"}`}>{b.status}</Badge>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {b.items.length === 0 ? (
                      <p className="text-xs text-ct-muted">No items yet.</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {b.items.map((i) => (
                          <div key={i.id} className="rounded-lg border border-ct-border bg-ct-cloud/40 p-2">
                            <ImageIcon className="size-4 text-ct-muted mb-1" />
                            <p className="text-xs font-medium text-ct-navy truncate">{i.label}</p>
                            {i.notes && <p className="text-[10px] text-ct-muted truncate">{i.notes}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-1">
                      <Button size="sm" variant="outline" onClick={() => { setAddingTo(b); setItemLabel(""); setItemNotes(""); }}>
                        <Plus className="size-3.5 mr-1" /> Add Item
                      </Button>
                      {b.status === "draft" && <Button size="sm" variant="ghost" onClick={() => setStatus(b, "shared")}>Share with Client</Button>}
                      {b.status === "shared" && <Button size="sm" variant="ghost" onClick={() => setStatus(b, "approved")}>Mark Approved</Button>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={!!addingTo} onOpenChange={(v) => !v && setAddingTo(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Item: {addingTo?.title}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Label</Label>
              <Input value={itemLabel} onChange={(e) => setItemLabel(e.target.value)} placeholder="e.g. Accent Wallpaper" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Notes (optional)</Label>
              <Textarea value={itemNotes} onChange={(e) => setItemNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={addItem} disabled={addingItem || !itemLabel.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {addingItem ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
