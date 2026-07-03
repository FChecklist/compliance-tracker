"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type KbPage = { id: string; title: string; content: string | null; version: number };

export default function KnowledgeBasePageView() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params.slug;

  const [page, setPage] = useState<KbPage | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/knowledge-base/pages/by-slug?slug=${slug}`);
    if (res.ok) {
      const pageData = await res.json();
      setPage(pageData);
      setTitle(pageData.title);
      setContent(pageData.content ?? "");
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!page) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/knowledge-base/pages/${page.id}`, {
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
        <Button variant="ghost" size="sm" onClick={() => router.push("/knowledge-base")}>
          <ArrowLeft className="size-4 mr-2" />
          Knowledge Base
        </Button>
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
