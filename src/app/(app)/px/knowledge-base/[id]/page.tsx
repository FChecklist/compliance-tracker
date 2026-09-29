"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge, Knowledge Base module -- see ../page.tsx's header
// comment for the full port rationale. Port of PROJEXA's
// KnowledgeBaseObjectClient.tsx: unlike the native /knowledge-base/[slug]
// page (title + an always-editable Textarea, no display mode, no archive),
// this is a real Object Page with separate display/edit modes, a
// published/archived/internal status badge, and a real Archive action
// (soft-delete -- updateKbPage({isArchived:true}); listKbPages already
// excludes archived pages, this is just the first UI that can reach it) --
// bringing knowledge-base-service.ts's own isPublished/isArchived fields
// (live since Wave 29 / the Helpdesk gap-closure) to a UI for the first
// time anywhere in this repo.
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, Loader2, ArrowLeft, Archive, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type KbPage = {
  id: string;
  slug: string;
  title: string;
  content: string | null;
  version: number;
  isArchived: boolean;
  isPublished: boolean;
};

const STATUS_BADGE: Record<string, string> = {
  archived: "bg-ct-cloud text-ct-muted",
  published: "bg-green-100 text-green-700",
  internal: "bg-ct-saffron/20 text-ct-saffron-text",
};

export default function PxKnowledgeBaseObjectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const pageId = params.id;

  const [page, setPage] = useState<KbPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/knowledge-base/${pageId}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load this page");
      setPage(data);
      setLoadError(null);
    } catch (err) {
      setPage(null);
      setLoadError(err instanceof Error && err.message ? err.message : "Couldn't load this page");
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => { load(); }, [load]);

  function startEdit() {
    if (!page) return;
    setDraftTitle(page.title);
    setDraftContent(page.content ?? "");
    setMode("edit");
  }

  async function saveEdit() {
    if (!draftTitle.trim()) { toast.error("Title is required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/projexa/knowledge-base/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draftTitle.trim(), content: draftContent }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to save page");
      toast.success("Page saved");
      setMode("display");
      setPage(data);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't save page");
    } finally {
      setSaving(false);
    }
  }

  async function archivePage() {
    setArchiving(true);
    try {
      const res = await fetch(`/api/v1/projexa/knowledge-base/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to archive page");
      toast.success("Page archived");
      router.push("/px/knowledge-base");
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't archive page");
    } finally {
      setArchiving(false);
    }
  }

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-ct-muted" /></div>;
  }

  const statusKey = page?.isArchived ? "archived" : page?.isPublished ? "published" : "internal";
  const statusLabel = page?.isArchived ? "Archived" : page?.isPublished ? "Published" : "Internal";

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.push("/px/knowledge-base")}>
        <ArrowLeft className="size-4 mr-2" />
        Knowledge Base
      </Button>

      {loadError || !page ? (
        <p role="alert" className="text-sm text-ct-error">{loadError ?? "Page not found."}</p>
      ) : (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              {mode === "display" && <h1 className="text-2xl font-heading text-ct-navy">{page.title}</h1>}
              <Badge className={`text-xs border-0 ${STATUS_BADGE[statusKey]}`}>{statusLabel}</Badge>
              <span className="text-xs text-ct-muted">v{page.version}</span>
            </div>
            <div className="flex items-center gap-2">
              {mode === "display" ? (
                <>
                  {!page.isArchived && (
                    <Button variant="outline" size="sm" onClick={startEdit}>
                      <Pencil className="size-4 mr-2" />
                      Edit
                    </Button>
                  )}
                  {!page.isArchived && (
                    <Button variant="outline" size="sm" onClick={archivePage} disabled={archiving}>
                      {archiving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Archive className="size-4 mr-2" />}
                      Archive
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setMode("display")} disabled={saving}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={saveEdit}
                    disabled={saving || !draftTitle.trim()}
                    className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
                  >
                    {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
                    Save
                  </Button>
                </>
              )}
            </div>
          </div>

          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-6 space-y-4">
              {mode === "edit" ? (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
                    <Input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} className="text-xl font-heading" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Content</Label>
                    <Textarea
                      value={draftContent}
                      onChange={(e) => setDraftContent(e.target.value)}
                      placeholder="Write in Markdown..."
                      className="min-h-[400px] font-mono text-sm"
                    />
                  </div>
                </>
              ) : (
                <div className="whitespace-pre-wrap text-sm text-ct-navy min-h-[100px]">
                  {page.content || <span className="text-ct-muted">This page is empty. Click Edit to add content.</span>}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
