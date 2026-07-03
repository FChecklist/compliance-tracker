"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ProjectNav from "@/components/pms/ProjectNav";

type WikiPage = { id: string; title: string; content: string | null; version: number };

export default function WikiPageView() {
  const params = useParams<{ projectId: string; slug: string }>();
  const projectId = params.projectId;
  const slug = params.slug;

  const [projectName, setProjectName] = useState("");
  const [page, setPage] = useState<WikiPage | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [projectRes, pageRes] = await Promise.all([
      fetch(`/api/projects/${projectId}`),
      fetch(`/api/pms/wiki/by-slug?projectId=${projectId}&slug=${slug}`),
    ]);
    const project = await projectRes.json();
    setProjectName(project.name ?? "Project");
    if (pageRes.ok) {
      const pageData = await pageRes.json();
      setPage(pageData);
      setTitle(pageData.title);
      setContent(pageData.content ?? "");
    }
    setLoading(false);
  }, [projectId, slug]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!page) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/pms/wiki/${page.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      if (!res.ok) throw new Error();
      toast.success("Page saved");
      load();
    } catch {
      toast.error("Failed to save page");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!page) return <p className="text-sm text-ct-muted">Page not found.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <ProjectNav projectId={projectId} projectName={projectName} />
        <Button onClick={save} disabled={saving} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
          {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
          Save
        </Button>
      </div>

      <div className="rounded-xl border border-ct-border bg-white p-6 space-y-4">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-xl font-heading border-none px-0 focus-visible:ring-0"
        />
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write in Markdown..."
          className="min-h-[400px] font-mono text-sm"
        />
        <p className="text-xs text-ct-muted">Version {page.version}</p>
      </div>
    </div>
  );
}
