"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own LeadObjectClient.tsx -- facets, an inline status Select,
// and the stage-change history log. Reads/writes the already-native
// GET/PATCH /api/v1/projexa/leads/[id] and
// GET /api/v1/projexa/leads/[id]/history (thin aliases over
// crm-service.ts's getLead/updateLead/listStageHistory) -- zero new backend
// route.
//
// Rebuilt on this repo's own Card (matching
// src/app/(app)/sales-orders/[id]/page.tsx), not PROJEXA's own
// @fchecklist/veridian-ui-kit ObjectScreen.
//
// Scope decision (same boundary the real PATCH route's own comment already
// draws): AI lead scoring, follow-up-task chaining, and Delete are NOT
// ported here -- deleteLead() needs a real role-gated actor context and
// blocks on linked opportunities, out of scope for a straight UI port.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Lead = {
  id: string; name: string; contactEmail: string | null; contactPhone: string | null;
  source: string | null; status: string; ownerId: string | null;
  nextActionDate: string | null; nextActionNote: string | null;
};
type HistoryEntry = { id: string; fromStage: string | null; toStage: string; note: string | null; changedAt: string };

const STATUS_OPTIONS = ["new", "contacted", "qualified", "converted", "lost"];
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  new: "outline", contacted: "secondary", qualified: "secondary", converted: "default", lost: "destructive",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const leadId = params.id;

  const [lead, setLead] = useState<Lead | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/leads/${encodeURIComponent(leadId)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't load this lead");
      setLead(body as Lead);
      setLoadError(null);

      // Stage history is a secondary, non-fatal section.
      try {
        const historyRes = await fetch(`/api/v1/projexa/leads/${encodeURIComponent(leadId)}/history`);
        const historyBody = await historyRes.json().catch(() => null);
        setHistory(historyRes.ok ? (historyBody?.history ?? []) : []);
      } catch {
        setHistory([]);
      }
    } catch (err) {
      setLead(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this lead");
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { void load(); }, [load]);

  async function updateStatus(status: string) {
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/v1/projexa/leads/${encodeURIComponent(leadId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to update lead status");
      toast.success(`Moved to ${status}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update lead status");
    } finally {
      setStatusBusy(false);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !lead) {
    return (
      <div className="space-y-3 p-6">
        <Link href="/sales/leads" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" />Back to Leads
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Lead not found."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/sales/leads")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Leads
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-heading text-ct-navy">{lead.name}</h1>
          <Badge variant={STATUS_VARIANT[lead.status] ?? "outline"} className="capitalize">{lead.status}</Badge>
        </div>
        <p className="text-sm text-ct-muted mt-1">
          Contact: {lead.contactEmail ?? lead.contactPhone ?? "—"} &middot; Source: {lead.source ?? "—"}
          &middot; Owner: {lead.ownerId ?? "—"} &middot; Next Follow-up: {lead.nextActionDate ?? "—"}
        </p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <span className="text-xs font-semibold text-ct-muted uppercase mr-1">Status</span>
          <Select value={lead.status} onValueChange={updateStatus}>
            <SelectTrigger className="h-8 w-48" disabled={statusBusy}>
              {statusBusy ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
          </Select>
        </CardContent>
      </Card>

      {lead.nextActionNote && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">Follow-up Note</CardTitle></CardHeader>
          <CardContent className="text-sm text-ct-muted">{lead.nextActionNote}</CardContent>
        </Card>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Stage History</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-ct-muted">No stage changes recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between rounded-md border border-ct-border px-3 py-2 text-sm">
                  <span className="text-ct-navy">{h.fromStage ? `${h.fromStage} → ${h.toStage}` : `Created as ${h.toStage}`}</span>
                  <span className="text-ct-muted">{formatDate(h.changedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
