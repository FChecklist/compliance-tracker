"use client";

// force-dynamic: without this, Next.js statically prerenders this page at
// build time and Vercel's edge cache serves it directly on cache hits,
// bypassing middleware's auth redirect entirely (confirmed live -- an
// anonymous request got a cached 200 page shell instead of a 307 to
// /login, even though middleware.ts's allowlist correctly includes this
// route). No data actually leaked (all fetches go through requireAuth()
// API routes, which correctly 401'd throughout), but this closes the gap.
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, BookOpen, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

type KbPage = { id: string; slug: string; title: string };

export default function KnowledgeBaseIndexPage() {
  const router = useRouter();

  const [pages, setPages] = useState<KbPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  // Wave 81 (Customer Service enhancements): the one missing piece for
  // "Knowledge Base articles + search" -- articles/pages already existed.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KbPage[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/knowledge-base/pages");
    const data = await res.json();
    setPages(data.pages ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchResults(null); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      fetch(`/api/knowledge-base/pages/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setSearchResults(d.pages ?? []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const createPage = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/knowledge-base/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error();
      const page = await res.json();
      toast.success("Page created");
      setOpen(false);
      setTitle("");
      router.push(`/knowledge-base/${page.slug}`);
    } catch {
      toast.error("Failed to create page");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Knowledge Base</h1>
          <p className="text-sm text-ct-muted mt-1">Org-wide pages -- SOPs, playbooks, and reference notes, shared across every project.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              <Plus className="size-4 mr-2" />
              New Page
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Knowledge Base Page</DialogTitle>
              <DialogDescription>Create a new page, visible to your whole organisation.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Onboarding Checklist" />
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

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ct-muted" />
        <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search knowledge base..." className="pl-9" />
      </div>

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : searchResults !== null ? (
        searching ? (
          <p className="text-sm text-ct-muted">Searching...</p>
        ) : searchResults.length === 0 ? (
          <p className="text-sm text-ct-muted">No pages match &quot;{searchQuery}&quot;.</p>
        ) : (
          <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
            {searchResults.map((page) => (
              <button
                key={page.id}
                onClick={() => router.push(`/knowledge-base/${page.slug}`)}
                className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-ct-cloud transition-colors"
              >
                <BookOpen className="size-4 text-ct-teal shrink-0" />
                <span className="text-sm font-medium text-ct-navy">{page.title}</span>
              </button>
            ))}
          </div>
        )
      ) : pages.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center space-y-2">
            <BookOpen className="size-10 text-ct-muted mx-auto" />
            <p className="text-sm text-ct-muted">No knowledge base pages yet. Create the first one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
          {pages.map((page) => (
            <button
              key={page.id}
              onClick={() => router.push(`/knowledge-base/${page.slug}`)}
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
