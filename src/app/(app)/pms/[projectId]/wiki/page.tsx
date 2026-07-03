"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import ProjectNav from "@/components/pms/ProjectNav";

type WikiPage = { id: string; slug: string; title: string };

export default function WikiIndexPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params.projectId;

  const [projectName, setProjectName] = useState("");
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [projectRes, pagesRes] = await Promise.all([
      fetch(`/api/projects/${projectId}`),
      fetch(`/api/pms/wiki?projectId=${projectId}`),
    ]);
    const [project, pagesData] = await Promise.all([projectRes.json(), pagesRes.json()]);
    setProjectName(project.name ?? "Project");
    setPages(pagesData.pages ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const createPage = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/pms/wiki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title }),
      });
      if (!res.ok) throw new Error();
      const page = await res.json();
      toast.success("Page created");
      setOpen(false);
      setTitle("");
      router.push(`/pms/${projectId}/wiki/${page.slug}`);
    } catch {
      toast.error("Failed to create page");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <ProjectNav projectId={projectId} projectName={projectName} />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              <Plus className="size-4 mr-2" />
              New Page
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Wiki Page</DialogTitle>
              <DialogDescription>Create a new documentation page for this project.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Getting Started" />
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

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : pages.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center space-y-2">
            <BookOpen className="size-10 text-ct-muted mx-auto" />
            <p className="text-sm text-ct-muted">No wiki pages yet. Create the first one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
          {pages.map((page) => (
            <button
              key={page.id}
              onClick={() => router.push(`/pms/${projectId}/wiki/${page.slug}`)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-ct-cloud transition-colors"
            >
              <BookOpen className="size-4 text-ct-teal shrink-0" />
              <span className="text-sm font-medium text-ct-navy">{page.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
