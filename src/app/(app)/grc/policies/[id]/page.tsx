"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge module 21/24 (GRC): port of PROJEXA's own
// PolicyObjectClient.tsx (src/app/(app)/grc/policies/[id]/page.tsx there).
// Reads GET /api/v1/projexa/policies/[id] (getPolicy in
// risk-register-service.ts, returns the policy object directly -- unwrapped,
// includes `history`, the real edit/publish audit trail). Writes via
// PATCH .../[id] with {action:"edit", note} (bumps the minor version and
// appends history) or {action:"request_publish"} (opens a maker-checker
// approval request; only POST /api/approvals/[id]/decide actually flips
// status to "published" -- this page never calls that directly, matching
// PROJEXA's own source verbatim).
//
// UI is compliance-tracker's own shadcn Card/Badge/Textarea (house
// convention), not PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type HistoryEntry = { version: string; date: string; editedBy: string; note: string };
type Policy = {
  id: string; title: string; category: string; version: string; status: string;
  attestationRate: number | null; history: HistoryEntry[] | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", under_review: "secondary", published: "default",
};

export default function PolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const policyId = params.id;

  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/policies/${encodeURIComponent(policyId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load this policy");
      setPolicy(data as Policy);
      setLoadError(null);
    } catch (err) {
      setPolicy(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this policy");
    } finally {
      setLoading(false);
    }
  }, [policyId]);

  useEffect(() => { void load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/projexa/policies/${encodeURIComponent(policyId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit", note: note || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to save policy");
      toast.success(`Updated to ${data.version}`);
      setNote("");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save policy");
    } finally {
      setSaving(false);
    }
  }

  async function requestPublish() {
    setPublishing(true);
    try {
      const res = await fetch(`/api/v1/projexa/policies/${encodeURIComponent(policyId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request_publish" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to request publish");
      toast.success("Publish requested — awaiting maker-checker approval");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't request publish");
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !policy) {
    return (
      <div className="space-y-3">
        <Link href="/grc?tab=policies" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" /> Back to Policies
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Policy not found."}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/grc?tab=policies")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Policies
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">{policy.title}</h1>
            <span className="text-sm text-ct-muted">{policy.version}</span>
            <Badge variant={STATUS_VARIANT[policy.status] ?? "outline"} className="capitalize">{policy.status.replace(/_/g, " ")}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {mode === "display" && (
              <>
                <Button size="sm" variant="outline" onClick={() => { setNote(""); setMode("edit"); }}>Edit</Button>
                {policy.status === "draft" && (
                  <Button size="sm" disabled={publishing} onClick={requestPublish} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
                    {publishing ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
                    {publishing ? "Requesting…" : "Request Publish"}
                  </Button>
                )}
              </>
            )}
            {mode === "edit" && (
              <>
                <Button size="sm" variant="outline" disabled={saving} onClick={() => setMode("display")}>Cancel edit</Button>
                <Button size="sm" disabled={saving} onClick={handleSave}>
                  {saving ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
                  {saving ? "Saving…" : "Save"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Policy Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><p className="text-xs font-medium text-ct-muted uppercase">Category</p><p className="mt-1 capitalize text-ct-navy">{policy.category.replace(/_/g, " ")}</p></div>
            <div><p className="text-xs font-medium text-ct-muted uppercase">Attestation Rate</p><p className="mt-1 text-ct-navy">{policy.attestationRate != null ? `${policy.attestationRate}%` : "—"}</p></div>
          </div>
          {mode === "edit" && (
            <div className="space-y-1.5 max-w-md">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Change Note (optional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What changed in this version?" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Version History</CardTitle></CardHeader>
        <CardContent>
          {!policy.history || policy.history.length === 0 ? (
            <p className="text-sm text-ct-muted">No history recorded.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {policy.history.map((h, i) => (
                <li key={i} className="text-ct-navy">
                  <span className="font-medium">{h.version}</span> — {h.date} by {h.editedBy}{h.note ? `: "${h.note}"` : ""}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
