"use client";

export const dynamic = "force-dynamic";

// VERIDIAN_Architecture_v2.0 phase_8 (2026-07-28): engine-prompt-
// marketplace. Real browse/list surface over Production-lifecycle prompt
// versions an admin has opted to list -- reachable by any signed-in user;
// the publish/unlist action 403s for non-admins at the service layer, same
// posture as prompt-eval/page.tsx.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Store, Plus, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PromptTemplateGroup = {
  templateKey: string; displayName: string;
  versions: { id: string; version: number; lifecycleState: string }[];
};
type MarketplaceListing = {
  id: string; promptVersionId: string; title: string; description: string | null;
  tags: string[]; status: string; createdAt: string;
};

export default function PromptMarketplacePage() {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [templates, setTemplates] = useState<PromptTemplateGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const [publishOpen, setPublishOpen] = useState(false);
  const [versionId, setVersionId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    const [listingsRes, templatesRes] = await Promise.all([
      fetch("/api/prompt-marketplace"),
      fetch("/api/settings/prompts"),
    ]);
    setListings((await listingsRes.json()).listings ?? []);
    setTemplates((await templatesRes.json()).templates ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const productionVersions = templates.flatMap((t) =>
    t.versions.filter((v) => v.lifecycleState === "Production").map((v) => ({ ...v, templateKey: t.templateKey, displayName: t.displayName }))
  );

  async function publish() {
    if (!versionId || !title.trim()) { toast.error("A Production version and title are required"); return; }
    setPublishing(true);
    const res = await fetch("/api/prompt-marketplace", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        versionId, title, description: description.trim() || undefined,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    });
    setPublishing(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to publish listing"); return; }
    toast.success("Listed on the prompt marketplace");
    setPublishOpen(false);
    setVersionId(""); setTitle(""); setDescription(""); setTags("");
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2"><Store className="w-6 h-6" />Prompt Marketplace</h1>
          <p className="text-sm text-ct-muted mt-1">Browse Production-ready prompts shared across organizations. Only Production-lifecycle versions may be listed.</p>
        </div>
        <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
          <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal/90"><Plus className="w-4 h-4 mr-1" />List a Prompt</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>List a Production Prompt</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Prompt Version (Production only)</Label>
                <Select value={versionId} onValueChange={setVersionId}>
                  <SelectTrigger><SelectValue placeholder="Select a Production version" /></SelectTrigger>
                  <SelectContent>
                    {productionVersions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.displayName} v{v.version}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Customer Support Triage Prompt" /></div>
              <div><Label>Description</Label><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <div><Label>Tags (comma-separated)</Label><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="support, triage" /></div>
            </div>
            <DialogFooter><Button onClick={publish} disabled={publishing}>{publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : "List Prompt"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : listings.length === 0 ? (
        <p className="text-sm text-ct-muted">No prompts listed yet.</p>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {listings.map((l) => (
            <Card key={l.id} className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4 space-y-2">
                <h3 className="font-medium text-ct-navy text-sm">{l.title}</h3>
                {l.description && <p className="text-xs text-ct-muted">{l.description}</p>}
                <div className="flex flex-wrap gap-1">
                  {l.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                </div>
                <p className="text-xs text-ct-muted">{new Date(l.createdAt).toLocaleDateString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
