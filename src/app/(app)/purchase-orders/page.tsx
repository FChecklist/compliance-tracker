"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own Purchase Orders list (src/app/(app)/purchase-orders/page.tsx
// + PurchaseOrdersClient.tsx there). Reads the SAME
// GET /api/v1/projexa/purchase-orders this app's backend already serves (a
// thin alias over erp-buying-service.ts's listPurchaseOrders -- see that
// route's own header comment), zero new backend route, zero HTTP hop to a
// separate origin.
//
// UI is compliance-tracker's own shadcn Table/Card/Select (matching the
// house convention every already-ported PROJEXA page uses -- see
// src/app/(app)/customers/page.tsx, src/app/(app)/kpis/page.tsx), not
// PROJEXA's @fchecklist/veridian-ui-kit ScreenFrame/ListScreen. Porting the
// DATA and BEHAVIOUR, not the exact component tree.
//
// This coexists with the native src/app/(app)/erp/procurement/page.tsx --
// that page is the Requisition -> RFQ -> Quotation procurement WORKFLOW
// above the PO (a different, finance-department audience/screen), with only
// a one-click "quotation -> PO" action once a PO exists. Neither this list
// nor PROJEXA itself has ever had a Requisition/RFQ screen, so there is no
// duplicate here -- same "coexist, don't replace" precedent PR #1968
// (Budgets) already established for /erp/budgets vs /budgets.
//
// Company scope: PROJEXA's own PurchaseOrdersClient.tsx renders a
// CompanySelector (company-scope.tsx, a component private to that repo).
// This repo has no equivalent shared component, so the filter is rebuilt
// here as a plain Select reading the same GET /api/v1/projexa/companies +
// ?companyId= query param listPurchaseOrders already supports -- same
// data/behaviour, no new component invented.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type PurchaseOrder = {
  id: string; poNumber: number; vendorId: string; orderDate: string; expectedDeliveryDate: string | null;
  status: string; companyId: string | null; currencyId: string | null; exchangeRate: string; grandTotal: string;
};
type Vendor = { id: string; vendorName: string };
type Company = { id: string; companyName: string; abbr: string | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline", submitted: "secondary", partially_received: "secondary", completed: "default", cancelled: "destructive",
};
const ALL_COMPANIES = "__all__";

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const currencies = useCurrencies();

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>(ALL_COMPANIES);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (filterCompanyId: string) => {
    setLoading(true);
    try {
      const qs = filterCompanyId !== ALL_COMPANIES ? `?companyId=${encodeURIComponent(filterCompanyId)}` : "";
      const res = await fetch(`/api/v1/projexa/purchase-orders${qs}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Couldn't load purchase orders (HTTP ${res.status})`);
      setOrders(body.purchaseOrders ?? []);
      setLoadError(null);
    } catch (err) {
      setOrders([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load purchase orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(companyId); }, [companyId, load]);

  useEffect(() => {
    fetch("/api/v1/projexa/vendors").then((r) => r.json()).then((d) => setVendors(d.vendors ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    // Display-only lookup, same as the row-company scope: a failure here
    // degrades to no filter, not a broken list.
    fetch("/api/v1/projexa/companies").then((r) => r.json()).then((d) => setCompanies(d.companies ?? [])).catch(() => {});
  }, []);

  const money = (n: string | number | null | undefined) =>
    n === null || n === undefined || n === ""
      ? "—"
      : `${currencyLabel(undefined, currencies)}${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Purchase Orders</h1>
          <p className="text-sm text-ct-muted mt-1">Orders raised against vendors -- submit, receive goods, and track spend.</p>
        </div>
        <div className="flex items-center gap-2">
          {companies.length > 0 && (
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_COMPANIES}>All companies</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
            onClick={() => router.push("/purchase-orders/new")}
          >
            <Plus className="size-4 mr-1" /> New Purchase Order
          </Button>
        </div>
      </div>

      {loadError ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center space-y-3">
            <p className="text-sm text-red-600">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => load(companyId)}>Retry</Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
            ) : orders.length === 0 ? (
              <p className="py-10 text-center text-sm text-ct-muted">No purchase orders yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Order Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((po) => (
                    <TableRow
                      key={po.id}
                      className="cursor-pointer hover:bg-ct-row-hover"
                      onClick={() => router.push(`/purchase-orders/${po.id}`)}
                    >
                      <TableCell className="flex items-center gap-2 font-medium text-ct-navy">
                        <Truck className="size-4 text-ct-muted" />PO-{po.poNumber}
                      </TableCell>
                      <TableCell className="text-ct-muted">{vendors.find((v) => v.id === po.vendorId)?.vendorName ?? "—"}</TableCell>
                      <TableCell className="text-ct-muted">{po.orderDate}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(po.grandTotal)}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[po.status] ?? "outline"}>{po.status.replace(/_/g, " ")}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
