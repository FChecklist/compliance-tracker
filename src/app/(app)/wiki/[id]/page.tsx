"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge, batch 2 -- see src/app/(app)/wiki/page.tsx's header
// comment for the full port rationale, including why Edit is offered here
// (a real, deliberate difference from PROJEXA's own WikiObjectClient.tsx,
// which disclosed Edit as blocked because ITS calls go through a shared,
// API-key-authenticated HTTP hop -- this page calls the same backend
// same-origin with the viewer's own real signed-in session, so
// PATCH /api/v1/projexa/wiki/[id] always has ctx.dbUser set).
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type WikiPageDetail = {
  id: string; projectId: string; slug: string; title: string; content: string | null; version: number;
};

export default function WikiObjectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const pageId = params.id;

  const [page, setPage] = useState<WikiPageDetail | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/v1/projexa/wiki/${encodeURIComponent(pageId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load this wiki page");
      setPage(data);
      setTitle(data.title);
      setContent(data.content ?? "");
    } catch (err) {
      setPage(null);
      setLoadError(err instanceof Error && err.message ? err.message : "Couldn't load this wiki page");
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!page || !title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/projexa/wiki/${encodeURIComponent(page.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to save page");
      setPage(data);
      setTitle(data.title);
      setContent(data.content ?? "");
      toast.success("Page saved");
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to save page");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-ct-muted-text">Loading...</p>;
  if (loadError) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-ct-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!page) return <p className="text-sm text-ct-muted-text">Page not found.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/wiki?projectId=${page.projectId}`)}>
          <ArrowLeft className="size-4 mr-2" /> Wiki
        </Button>
        <Button onClick={save} disabled={saving || !title.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
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
        <p className="text-xs text-ct-muted-text">Version {page.version}</p>
      </div>
    </div>
  );
}
