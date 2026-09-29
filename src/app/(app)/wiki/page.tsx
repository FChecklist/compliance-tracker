"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge, batch 2 (compliance-tracker/PROJEXA merge): per-
// project Wiki, ported from PROJEXA's own WikiClient.tsx/
// WikiCreateClient.tsx/WikiObjectClient.tsx onto compliance-tracker's
// ALREADY-NATIVE backend at /api/v1/projexa/wiki/** (pms-wiki-service.ts) --
// same-origin fetch, real signed-in session, zero HTTP hop to PROJEXA.
//
// Two real, deliberate deviations from PROJEXA's own UI:
//
// 1. Project selection: PROJEXA resolves the active project from a
//    URL-based global project switcher this repo doesn't have. Adapted to
//    this repo's own established ProjectPicker convention (same as
//    site-diary/permits/rfis/submittals/punch-list/scope/labour/expenses).
//
// 2. "New Page": PROJEXA routes to a dedicated /wiki/new screen
//    (WikiCreateClient.tsx, built on PROJEXA's own veridian-ui-kit
//    ObjectScreen). This repo already has two already-merged pages against
//    this exact same underlying table/service shape --
//    src/app/(app)/pms/[projectId]/wiki/page.tsx and
//    src/app/(app)/knowledge-base/page.tsx -- and both use a Dialog instead
//    of a separate route for page creation. Followed that established
//    convention here rather than adding a third pattern for the same job.
//
// Edit (see src/app/(app)/wiki/[id]/page.tsx) is genuinely offered here,
// unlike PROJEXA's own WikiObjectClient.tsx, which disclosed Edit as
// unavailable because ITS calls go through a shared, API-key-authenticated
// HTTP hop (updateWikiPage() 400s without a real ctx.dbUser). That
// limitation does not apply to this native page: it calls the same backend
// same-origin with the viewer's own real signed-in session, so
// PATCH /api/v1/projexa/wiki/[id] always has ctx.dbUser set -- the same
// reason the sibling src/app/(app)/pms/[projectId]/wiki/[slug]/page.tsx
// (identical table, identical constraint, already native) already offers a
// working Save with no disclosure banner.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type WikiPage = { id: string; slug: string; title: string; version: number };

export default function WikiIndexPage() {
  const router = useRouter();

  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [pages, setPages] = useState<WikiPage[]>([]);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
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
      const res = await fetch(`/api/v1/projexa/wiki?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to load wiki pages");
      setPages(data?.pages ?? []);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to load wiki pages");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const createPage = async () => {
    if (!projectId || !title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/projexa/wiki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title: title.trim(), content: content || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to create page");
      toast.success("Page created");
      setOpen(false);
      setTitle("");
      setContent("");
      router.push(`/wiki/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to create page");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Wiki</h1>
          <p className="text-sm text-ct-muted-text mt-1">Per-project documentation -- plain text/markdown pages, no collaborative editor.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
              <Plus className="size-4 mr-1" /> New Page
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Wiki Page</DialogTitle>
              <DialogDescription>Create a new documentation page for this project.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted-text uppercase">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Getting Started" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted-text uppercase">Content (optional)</Label>
                <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} className="font-mono text-sm" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createPage} disabled={creating || !title.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create Page
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted-text">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={BookOpen} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <p className="text-sm text-ct-muted-text">Loading...</p>
          ) : pages.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-10 pb-10 text-center space-y-2">
                <BookOpen className="size-10 text-ct-muted mx-auto" />
                <p className="text-sm text-ct-muted-text">No pages yet. Create the first one.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Title</TableHead><TableHead>Version</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {pages.map((page) => (
                      <TableRow key={page.id} className="cursor-pointer hover:bg-ct-cloud/40" onClick={() => router.push(`/wiki/${page.id}`)}>
                        <TableCell className="font-medium text-ct-navy">{page.title}</TableCell>
                        <TableCell className="text-ct-muted-text">v{page.version}</TableCell>
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
