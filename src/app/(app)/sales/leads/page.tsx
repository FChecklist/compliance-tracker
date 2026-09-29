"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own LeadsClient.tsx -- the leads list, with a search box, a
// status filter, an inline status Select per row, and a bulk-reassign bar.
// Reads/writes the already-native GET/POST /api/v1/projexa/leads,
// PATCH /api/v1/projexa/leads/[id] and POST
// /api/v1/projexa/leads/bulk-reassign (thin aliases over crm-service.ts's
// listLeadsPaged/createLead/updateLead/bulkReassignLeads) -- zero new
// backend route.
//
// Scope decision: PROJEXA's own CompanySelector (multi-office scope filter)
// is NOT ported here -- no other already-merged PROJEXA module in this repo
// (sales-orders being the one exception, which sources it from
// /api/v1/projexa/companies) has taken on that dependency for leads, and
// the real API route already supports an ownerId/source filter PROJEXA's
// own UI never exposed either; keeping this list to the two filters
// PROJEXA's UI actually shows (search, status) avoids inventing UI beyond
// what's being ported.
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

type Lead = {
  id: string; name: string; contactEmail: string | null; contactPhone: string | null;
  source: string | null; status: string; ownerId: string | null;
  nextActionDate: string | null; createdAt: string;
};

const STATUS_OPTIONS = ["new", "contacted", "qualified", "converted", "lost"];
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  new: "outline", contacted: "secondary", qualified: "secondary", converted: "default", lost: "destructive",
};

async function fetchOk<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Couldn't load ${what} (HTTP ${res.status})`);
  return body as T;
}

export default function LeadsPage() {
  const router = useRouter();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOwnerId, setBulkOwnerId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      const data = await fetchOk<{ leads?: Lead[]; total?: number }>(`/api/v1/projexa/leads?${params.toString()}`, "leads");
      setLeads(data.leads ?? []);
      setTotal(data.total ?? 0);
      setSelected(new Set());
      setLoadError(null);
    } catch (err) {
      setLeads([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load leads");
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  async function updateStatus(lead: Lead, status: string) {
    try {
      const res = await fetch(`/api/v1/projexa/leads/${encodeURIComponent(lead.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to update lead");
      toast.success(`${lead.name} moved to ${status}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update lead status");
    }
  }

  async function bulkReassign() {
    if (!selected.size || !bulkOwnerId.trim()) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/v1/projexa/leads/bulk-reassign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: Array.from(selected), ownerId: bulkOwnerId.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to bulk-reassign leads");
      toast.success(`Reassigned ${body.updated?.length ?? selected.size} lead(s)`);
      setBulkOwnerId("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't bulk-reassign leads");
    } finally {
      setBulkBusy(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Leads</h1>
        <p className="text-sm text-ct-muted mt-1">Sales / Leads</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search leads…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} className="w-56" />
          <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => router.push("/sales/leads/new")}>
          <Plus className="size-4 mr-1" /> New Lead
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
            <p role="alert">Could not load leads: {loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
      ) : leads.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No leads found.</CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={selected.size === leads.length && leads.length > 0}
                      onCheckedChange={(c) => setSelected(c ? new Set(leads.map((l) => l.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Source</TableHead>
                  <TableHead>Status</TableHead><TableHead>Next Follow-up</TableHead><TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l) => (
                  <TableRow key={l.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/sales/leads/${l.id}`)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(l.id)}
                        onCheckedChange={(c) => setSelected((prev) => { const next = new Set(prev); if (c) next.add(l.id); else next.delete(l.id); return next; })}
                      />
                    </TableCell>
                    <TableCell className="font-medium text-ct-navy">{l.name}</TableCell>
                    <TableCell className="text-ct-muted">{l.contactEmail ?? l.contactPhone ?? "—"}</TableCell>
                    <TableCell className="text-ct-muted">{l.source ?? "—"}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Select value={l.status} onValueChange={(v) => updateStatus(l, v)}>
                        <SelectTrigger className="h-7 w-32 border-none p-0 shadow-none">
                          <Badge variant={STATUS_VARIANT[l.status] ?? "outline"} className="capitalize">{l.status}</Badge>
                        </SelectTrigger>
                        <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-ct-muted">{l.nextActionDate ?? "—"}</TableCell>
                    <TableCell className="text-ct-muted">{l.ownerId ?? "—"}</TableCell>
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
          Page {page} of {totalPages} — {total} lead(s)
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
