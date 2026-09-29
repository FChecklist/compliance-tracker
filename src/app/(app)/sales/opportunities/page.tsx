"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own OpportunitiesClient.tsx -- the opportunities list, with a
// search box, a stage filter, an inline stage Select per row, and a
// bulk-reassign bar. Reads/writes the already-native
// GET/POST /api/v1/projexa/opportunities, PATCH
// /api/v1/projexa/opportunities/[id] and POST
// /api/v1/projexa/opportunities/bulk-reassign (thin aliases over
// crm-service.ts's listOpportunitiesPaged/createOpportunity/
// updateOpportunity/bulkReassignLeads-equivalent) -- zero new backend
// route. Customer names are resolved client-side from
// GET /api/v1/projexa/customers, matching PROJEXA's own
// `customerName(erpCustomerId)` lookup.
//
// UI is compliance-tracker's own shadcn Card/Table/Select (matching the
// house convention every already-ported PROJEXA-merge page uses: see
// src/app/(app)/sales-orders/page.tsx), not PROJEXA's own
// @fchecklist/veridian-ui-kit.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Opportunity = {
  id: string; name: string; leadId: string | null; erpCustomerId: string | null; stage: string;
  estimatedValue: string | null; expectedCloseDate: string | null; ownerId: string | null;
};
type Customer = { id: string; customerName: string };

const STAGE_OPTIONS = ["prospecting", "proposal", "negotiation", "won", "lost"];
const STAGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  prospecting: "outline", proposal: "secondary", negotiation: "secondary", won: "default", lost: "destructive",
};

async function fetchOk<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Couldn't load ${what} (HTTP ${res.status})`);
  return body as T;
}

export default function OpportunitiesPage() {
  const router = useRouter();
  const currencies = useCurrencies();

  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOwnerId, setBulkOwnerId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      if (stageFilter !== "all") params.set("stage", stageFilter);
      const data = await fetchOk<{ opportunities?: Opportunity[]; total?: number }>(
        `/api/v1/projexa/opportunities?${params.toString()}`, "opportunities"
      );
      setOpportunities(data.opportunities ?? []);
      setTotal(data.total ?? 0);
      setSelected(new Set());
      setLoadError(null);
    } catch (err) {
      setOpportunities([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load opportunities");
    } finally {
      setLoading(false);
    }
  }, [page, search, stageFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    fetch("/api/v1/projexa/customers").then((r) => r.json()).then((d) => setCustomers(d.customers ?? [])).catch(() => {});
  }, []);

  async function updateStage(opp: Opportunity, stage: string) {
    try {
      const res = await fetch(`/api/v1/projexa/opportunities/${encodeURIComponent(opp.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to update opportunity");
      toast.success(`${opp.name} moved to ${stage}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update opportunity stage");
    }
  }

  async function bulkReassign() {
    if (!selected.size || !bulkOwnerId.trim()) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/v1/projexa/opportunities/bulk-reassign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityIds: Array.from(selected), ownerId: bulkOwnerId.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to bulk-reassign opportunities");
      toast.success(`Reassigned ${body.updated?.length ?? selected.size} opportunity(ies)`);
      setBulkOwnerId("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't bulk-reassign opportunities");
    } finally {
      setBulkBusy(false);
    }
  }

  const customerName = (id: string | null) => customers.find((c) => c.id === id)?.customerName ?? id ?? "—";
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Opportunities</h1>
        <p className="text-sm text-ct-muted mt-1">Sales / Opportunities</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search opportunities…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} className="w-56" />
          <Select value={stageFilter} onValueChange={(v) => { setPage(1); setStageFilter(v); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Stage" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {STAGE_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => router.push("/sales/opportunities/new")}>
          <Plus className="size-4 mr-1" /> New Opportunity
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-ct-saffron/30 bg-ct-saffron/5 px-3 py-2 text-sm">
          <span className="text-ct-navy">{selected.size} selected</span>
          <Input placeholder="Owner user ID" value={bulkOwnerId} onChange={(e) => setBulkOwnerId(e.target.value)} className="h-8 w-56" />
          <Button size="sm" disabled={bulkBusy || !bulkOwnerId.trim()} onClick={bulkReassign}>Bulk Reassign</Button>
        </div>
      )}

      {loadError ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
            <p role="alert">Could not load opportunities: {loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
      ) : opportunities.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No opportunities found.</CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={selected.size === opportunities.length && opportunities.length > 0}
                      onCheckedChange={(c) => setSelected(c ? new Set(opportunities.map((o) => o.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead>Name</TableHead><TableHead>Customer</TableHead>
                  <TableHead className="text-right">Value</TableHead><TableHead>Stage</TableHead><TableHead>Expected Close</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opportunities.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/sales/opportunities/${o.id}`)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(o.id)}
                        onCheckedChange={(c) => setSelected((prev) => { const next = new Set(prev); if (c) next.add(o.id); else next.delete(o.id); return next; })}
                      />
                    </TableCell>
                    <TableCell className="font-medium text-ct-navy">{o.name}</TableCell>
                    <TableCell className="text-ct-muted">{customerName(o.erpCustomerId)}</TableCell>
                    <TableCell className="text-right text-ct-muted">
                      {o.estimatedValue ? `${currencyLabel(undefined, currencies)}${Number(o.estimatedValue).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Select value={o.stage} onValueChange={(v) => updateStage(o, v)}>
                        <SelectTrigger className="h-7 w-32 border-none p-0 shadow-none">
                          <Badge variant={STAGE_VARIANT[o.stage] ?? "outline"} className="capitalize">{o.stage}</Badge>
                        </SelectTrigger>
                        <SelectContent>{STAGE_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-ct-muted">{o.expectedCloseDate ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {total > pageSize && (
        <div className="flex items-center justify-center gap-3 text-sm text-ct-muted">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          Page {page} of {totalPages} — {total} opportunity(ies)
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
