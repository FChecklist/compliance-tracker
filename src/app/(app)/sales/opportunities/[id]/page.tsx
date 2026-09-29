"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own OpportunityObjectClient.tsx -- facets, an inline stage
// Select, and the stage-change history log. Reads/writes the already-native
// GET/PATCH /api/v1/projexa/opportunities/[id] and
// GET /api/v1/projexa/opportunities/[id]/history (thin aliases over
// crm-service.ts's getOpportunity/updateOpportunity/listStageHistory) --
// zero new backend route. Customer name is resolved client-side from
// GET /api/v1/projexa/customers, matching PROJEXA's own lookup.
//
// Rebuilt on this repo's own Card (matching
// src/app/(app)/sales-orders/[id]/page.tsx), not PROJEXA's own
// @fchecklist/veridian-ui-kit ObjectScreen.
//
// Scope decision (same boundary the real PATCH route's own comment already
// draws): AI win-probability analysis, follow-up-task chaining, and Delete
// are NOT ported here -- out of scope for a straight UI port.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Opportunity = {
  id: string; name: string; leadId: string | null; erpCustomerId: string | null; stage: string;
  estimatedValue: string | null; expectedCloseDate: string | null; ownerId: string | null; nextActionDate: string | null;
};
type HistoryEntry = { id: string; fromStage: string | null; toStage: string; note: string | null; changedAt: string };
type Customer = { id: string; customerName: string };

const STAGE_OPTIONS = ["prospecting", "proposal", "negotiation", "won", "lost"];
const STAGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  prospecting: "outline", proposal: "secondary", negotiation: "secondary", won: "default", lost: "destructive",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

export default function OpportunityDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const opportunityId = params.id;
  const currencies = useCurrencies();

  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stageBusy, setStageBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/opportunities/${encodeURIComponent(opportunityId)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't load this opportunity");
      setOpportunity(body as Opportunity);
      setLoadError(null);

      // Customer name + stage history are secondary, non-fatal sections.
      try {
        const custRes = await fetch("/api/v1/projexa/customers");
        const custBody = await custRes.json().catch(() => null);
        setCustomers(custRes.ok ? (custBody?.customers ?? []) : []);
      } catch {
        setCustomers([]);
      }
      try {
        const historyRes = await fetch(`/api/v1/projexa/opportunities/${encodeURIComponent(opportunityId)}/history`);
        const historyBody = await historyRes.json().catch(() => null);
        setHistory(historyRes.ok ? (historyBody?.history ?? []) : []);
      } catch {
        setHistory([]);
      }
    } catch (err) {
      setOpportunity(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this opportunity");
    } finally {
      setLoading(false);
    }
  }, [opportunityId]);

  useEffect(() => { void load(); }, [load]);

  async function updateStage(stage: string) {
    setStageBusy(true);
    try {
      const res = await fetch(`/api/v1/projexa/opportunities/${encodeURIComponent(opportunityId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to update opportunity stage");
      toast.success(`Moved to ${stage}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update opportunity stage");
    } finally {
      setStageBusy(false);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !opportunity) {
    return (
      <div className="space-y-3 p-6">
        <Link href="/sales/opportunities" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" />Back to Opportunities
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Opportunity not found."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  const customerName = customers.find((c) => c.id === opportunity.erpCustomerId)?.customerName ?? opportunity.erpCustomerId ?? "—";
  const money = (v: number) => `${currencyLabel(undefined, currencies)}${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-6 p-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/sales/opportunities")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Opportunities
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-heading text-ct-navy">{opportunity.name}</h1>
          <Badge variant={STAGE_VARIANT[opportunity.stage] ?? "outline"} className="capitalize">{opportunity.stage}</Badge>
        </div>
        <p className="text-sm text-ct-muted mt-1">
          Customer: {customerName} &middot; Value: {opportunity.estimatedValue ? money(Number(opportunity.estimatedValue)) : "—"}
          &middot; Expected Close: {opportunity.expectedCloseDate ?? "—"} &middot; Owner: {opportunity.ownerId ?? "—"}
        </p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <span className="text-xs font-semibold text-ct-muted uppercase mr-1">Stage</span>
          <Select value={opportunity.stage} onValueChange={updateStage}>
            <SelectTrigger className="h-8 w-48" disabled={stageBusy}>
              {stageBusy ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{STAGE_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
          </Select>
        </CardContent>
      </Card>

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
