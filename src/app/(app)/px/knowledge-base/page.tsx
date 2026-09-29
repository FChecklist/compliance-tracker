"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), Knowledge Base
// module -- LAST of the 7 name-collision px/ shadow modules (recruitment,
// hr, settings, dashboard, documents, reports already done/merged or in
// PR). Faithful UI port of PROJEXA's own Knowledge Base (FChecklist/projexa
// src/app/(app)/knowledge-base/{page.tsx,[id]/page.tsx,new/page.tsx} +
// KnowledgeBaseClient/KnowledgeBaseObjectClient/KnowledgeBaseCreateClient)
// into compliance-tracker as native pages calling the same already-native
// backend PROJEXA calls over HTTP today (/api/v1/projexa/knowledge-base/**,
// requireAuthOrApiKey() falls through to ordinary cookie-session auth for a
// same-origin request with no Bearer key) -- zero new backend logic.
//
// Lives at px/knowledge-base, NOT knowledge-base: this repo already has its
// own native /knowledge-base ({page.tsx,[slug]/page.tsx}, Wave 29/81) --
// verified this is the SAME class of collision as the already-merged
// px/recruitment (a real duplicate feature on the identical backend), NOT
// the "different product concept, same name" class px/hr and px/documents
// are -- there is no PROJEXA-specific scoping anywhere in this data at all:
// /api/v1/projexa/knowledge-base/** and /api/knowledge-base/pages/** are
// both, per their own header comments, thin aliases over the exact same
// src/lib/services/knowledge-base-service.ts functions (listKbPages,
// createKbPage, updateKbPage, getKbPage/getKbPageBySlug, searchKbPages) over
// the exact same org-scoped `knowledge_base_pages` table -- an org's PROJEXA
// visitors and its compliance-tracker visitors see and edit the identical
// rows. The native UI (list + search + create-via-dialog + a single
// always-editable [slug] page) never exposes `isArchived`/`isPublished`
// even though the service has carried both fields since Wave 29/the
// Helpdesk gap-closure -- this port brings PROJEXA's richer Object Page
// (separate display/edit modes, a real Archive = soft-delete action, a
// published/archived/internal status badge) to that identical data, the
// same "richer UI over identical data, consolidation left for later"
// resolution px/recruitment's own header comment already used. Distinct
// from the per-project Wiki (src/app/(app)/wiki/page.tsx, PR #1960): Wiki
// has its own separate service (pms-wiki-service.ts) and table
// (pms_wiki_pages), confirmed by direct source read before starting this
// port, not assumed from the name alone.
//
// Single-file "use client" page (no separate *Client.tsx split), matching
// this repo's own convention. UI rebuilt in compliance-tracker's own
// component vocabulary (@/components/ui/*, ct-navy/ct-muted/ct-saffron
// classes) -- PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen is not used
// anywhere in this port.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, BookOpen, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type KbPage = { id: string; slug: string; title: string; version: number };

export default function PxKnowledgeBasePage() {
  const router = useRouter();

  const [pages, setPages] = useState<KbPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KbPage[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/v1/projexa/knowledge-base");
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load the knowledge base");
      setPages(data?.pages ?? []);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "Couldn't load the knowledge base";
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchResults(null); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      fetch(`/api/v1/projexa/knowledge-base/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setSearchResults(d.pages ?? []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-ct-muted" /></div>;
  }

  const rows = searchResults !== null ? searchResults : pages;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Knowledge Base</h1>
          <p className="text-sm text-ct-muted mt-1">Org-wide pages -- SOPs, playbooks, and reference notes, shared across every project.</p>
        </div>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={() => router.push("/px/knowledge-base/new")}
        >
          <Plus className="size-4 mr-2" />
          New Page
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ct-muted" />
        <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search knowledge base..." className="pl-9" />
      </div>

      {loadError ? (
        <p role="alert" className="text-sm text-ct-error">{loadError}</p>
      ) : searchResults !== null && searching ? (
        <p className="text-sm text-ct-muted">Searching...</p>
      ) : rows.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center space-y-2">
            <BookOpen className="size-10 text-ct-muted mx-auto" />
            <p className="text-sm text-ct-muted">
              {searchResults !== null ? `No pages match "${searchQuery}".` : "No knowledge base pages yet. Create the first one."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
          {rows.map((page) => (
            <button
              key={page.id}
              onClick={() => router.push(`/px/knowledge-base/${page.id}`)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-ct-cloud transition-colors"
            >
              <BookOpen className="size-4 text-ct-teal shrink-0" />
              <span className="flex-1 text-sm font-medium text-ct-navy">{page.title}</span>
              <span className="text-xs text-ct-muted">v{page.version}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
