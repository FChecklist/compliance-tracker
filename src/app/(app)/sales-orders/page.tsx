"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own Sales Orders module (src/app/(app)/sales-orders/page.tsx +
// SalesOrdersClient.tsx there). Reads the already-native
// /api/v1/projexa/sales-orders (+ [id], bulk-status,
// sales-order-document-flow/[id]) -- zero new backend route, zero HTTP hop
// to a separate origin (verified field-for-field against each route.ts and
// erp-selling-service.ts before writing this file).
//
// Natural next step after quotations (#1975): a sent quotation converts to
// a sales order via the already-wired POST
// /api/v1/projexa/quotations/[id]/convert on the quotation detail page --
// not rebuilt here, this module is the sales-order side only.
//
// UI is compliance-tracker's own shadcn Card/Table/Select (matching the
// house convention every already-ported PROJEXA-merge page uses: see
// src/app/(app)/quotations/page.tsx / src/app/(app)/invoices/page.tsx), not
// PROJEXA's own @fchecklist/veridian-ui-kit ObjectScreen/CompanySelector.
//
// Scope decision: PROJEXA's optional multi-company/office filter
// (CompanySelector, Priority 17 final gap) is ported as a plain Select
// sourced from the real GET /api/v1/projexa/companies -- it only renders
// when the org actually has company rows, matching PROJEXA's own
// `companies.length > 0` gating, so an org with no companies set up sees no
// change at all.
//
// Bulk status bar is real (real POST /api/v1/projexa/sales-orders/bulk-status,
// manager-gated server-side by erp.sales_orders.update_status) -- not
// fabricated; skipped/missing ids are reported back from that route.
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

type SalesOrder = {
  id: string; soNumber: number; customerId: string | null; customerName: string | null;
  orderDate: string; deliveryDate: string | null; status: string;
  companyId: string | null;
  currencyId: string | null; exchangeRate: string; grandTotal: string;
};
type Company = { id: string; companyName: string; abbr: string | null };

const STATUS_OPTIONS = ["draft", "confirmed", "partially_fulfilled", "fulfilled", "cancelled"];
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", confirmed: "secondary", partially_fulfilled: "secondary", fulfilled: "default", cancelled: "destructive",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

async function fetchOk<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Couldn't load ${what} (HTTP ${res.status})`);
  return body as T;
}

export default function SalesOrdersPage() {
  const router = useRouter();
  const currencies = useCurrencies();

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyFilter, setCompanyFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (companyFilter !== "all") params.set("companyId", companyFilter);
      const data = await fetchOk<{ salesOrders?: SalesOrder[]; total?: number }>(
        `/api/v1/projexa/sales-orders?${params.toString()}`, "sales orders"
      );
      setOrders(data.salesOrders ?? []);
      setTotal(data.total ?? 0);
      setSelected(new Set());
      setLoadError(null);
    } catch (err) {
      setOrders([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load sales orders");
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, companyFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    fetch("/api/v1/projexa/companies").then((r) => r.json()).then((d) => setCompanies(d.companies ?? [])).catch(() => {});
  }, []);

  async function updateStatus(order: SalesOrder, status: string) {
    try {
      const res = await fetch(`/api/v1/projexa/sales-orders/${encodeURIComponent(order.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to update sales order");
      toast.success(`Order #${order.soNumber} → ${status.replace(/_/g, " ")}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update sales order");
    }
  }

  async function bulkStatus(status: string) {
    if (!selected.size) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/v1/projexa/sales-orders/bulk-status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesOrderIds: Array.from(selected), status }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to bulk-update status");
      const skipped = body.skippedIds?.length ?? 0;
      toast.success(`Updated ${body.updated?.length ?? 0} order(s)${skipped ? `, ${skipped} skipped (invalid transition)` : ""}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't bulk-update status");
    } finally {
      setBulkBusy(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Sales Orders</h1>
        <p className="text-sm text-ct-muted mt-1">Confirmed customer orders -- from a converted quotation or created directly, through fulfillment.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search by customer…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} className="w-56" />
          <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          {companies.length > 0 && (
            <Select value={companyFilter} onValueChange={(v) => { setPage(1); setCompanyFilter(v); }}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Company" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => router.push("/sales-orders/new")}>
          <Plus className="size-4 mr-1" /> New Sales Order
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-ct-saffron/30 bg-ct-saffron/5 px-3 py-2 text-sm">
          <span className="text-ct-navy">{selected.size} selected</span>
          {STATUS_OPTIONS.map((s) => (
            <Button key={s} size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkStatus(s)} className="capitalize">
              Mark {s.replace(/_/g, " ")}
            </Button>
          ))}
        </div>
      )}

      {loadError ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
            <p role="alert">Could not load sales orders: {loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
      ) : orders.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No sales orders found.</CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={selected.size === orders.length && orders.length > 0}
                      onCheckedChange={(c) => setSelected(c ? new Set(orders.map((o) => o.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead>#</TableHead><TableHead>Customer</TableHead><TableHead>Order Date</TableHead>
                  <TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/sales-orders/${o.id}`)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(o.id)}
                        onCheckedChange={(c) => setSelected((prev) => { const next = new Set(prev); if (c) next.add(o.id); else next.delete(o.id); return next; })}
                      />
                    </TableCell>
                    <TableCell className="font-medium text-ct-navy">{o.soNumber}</TableCell>
                    <TableCell className="text-ct-muted">{o.customerName ?? "—"}</TableCell>
                    <TableCell className="text-ct-muted">{formatDate(o.orderDate)}</TableCell>
                    <TableCell className="text-right">
                      {currencyLabel(o.currencyId, currencies)}{Number(o.grandTotal).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Select value={o.status} onValueChange={(v) => updateStatus(o, v)}>
                        <SelectTrigger className="h-7 w-40 border-none p-0 shadow-none">
                          <Badge variant={STATUS_VARIANT[o.status] ?? "outline"} className="capitalize">{o.status.replace(/_/g, " ")}</Badge>
                        </SelectTrigger>
                        <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
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
          Page {page} of {totalPages} — {total} order(s)
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
