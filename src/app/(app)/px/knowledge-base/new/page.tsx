"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge, Knowledge Base module -- see ../page.tsx's header
// comment for the full port rationale (same backend as this repo's own
// native /knowledge-base, richer PROJEXA Object Page ported over the
// identical data). Port of PROJEXA's KnowledgeBaseCreateClient.tsx: a
// title-only create screen (content is added afterwards on the Object
// Page), same as the native /knowledge-base "New Page" dialog's own scope.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PxKnowledgeBaseNewPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  async function createPage() {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/projexa/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to create page");
      toast.success("Page created");
      router.push(`/px/knowledge-base/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to create page");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.push("/px/knowledge-base")}>
        <ArrowLeft className="size-4 mr-2" />
        Knowledge Base
      </Button>

      <div className="rounded-xl border border-ct-border bg-white p-6 space-y-4 max-w-xl">
        <h1 className="text-xl font-heading text-ct-navy">New Knowledge Base Page</h1>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Onboarding Checklist" autoFocus />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.push("/px/knowledge-base")} disabled={creating}>
            Cancel
          </Button>
          <Button
            onClick={createPage}
            disabled={creating || !title.trim()}
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          >
            {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
            Create Page
          </Button>
        </div>
      </div>
    </div>
  );
}
