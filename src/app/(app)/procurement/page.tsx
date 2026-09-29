"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own Procurement workflow overview
// (src/app/(app)/procurement/page.tsx + ProcurementClient.tsx there) --
// Requisition -> RFQ -> Quotation -> Purchase Order -> Goods Receipt.
//
// Reads/writes the SAME six real /api/v1/projexa/procurement/* +
// /api/v1/projexa/vendors routes this app's backend already serves (thin
// aliases over erp-procurement-workflow-service.ts / erp-buying-service.ts /
// erp-goods-receipt-service.ts) -- zero new backend route, zero HTTP hop to
// a separate origin. Verified by reading each route handler directly, not
// assumed from PROJEXA's client code.
//
// UI is compliance-tracker's own shadcn Tabs/Card/Table (matching the house
// convention every already-ported PROJEXA page uses -- see
// src/app/(app)/purchase-orders/page.tsx, src/app/(app)/quotations/page.tsx),
// not PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen. Tab state is local
// (no ?tab= URL sync) -- a deliberate simplification vs PROJEXA's own
// goToTab()/history.replaceState dance, which exists there only to survive a
// server-component searchParams prop; this file is a plain "use client" page
// per the house convention, so there is no searchParams to sync from and
// adding one back would need a Suspense boundary for no real benefit.
//
// PURCHASE-ORDERS OVERLAP (documented per the porting brief): this repo
// already has a real Purchase Order Object Page at
// src/app/(app)/purchase-orders/[id]/page.tsx (PR #1969), which reads/writes
// the exact same GET/PATCH/DELETE /api/v1/projexa/procurement/purchase-orders
// /{id} + POST .../submit routes PROJEXA's own PurchaseOrderObjectClient.tsx
// would. Rather than duplicate it, the Purchase Orders tab below routes rows
// to that existing page. No procurement/purchase-orders/[id]/page.tsx is
// built in this module.
//
// The Quotations tab has no Object Page -- no getSupplierQuotation() exists
// upstream (only listSupplierQuotations), matching PROJEXA's own screen
// exactly ("Convert to PO" stays a real inline list action, not a route).
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Requisition = {
  id: string; requisitionNumber: number; purpose: string | null; status: string; postingDate: string;
  items: { id: string; description: string; quantity: string; estimatedRate: string | null }[];
};
type Rfq = {
  id: string; rfqNumber: number; status: string; postingDate: string; requisitionId: string | null;
  items: { id: string; description: string; quantity: string }[];
  suppliers: { supplierId: string }[];
};
type Quotation = {
  id: string; quotationNumber: number; status: string; postingDate: string; rfqId: string | null; supplierId: string;
  items: { id: string; itemId: string | null; description: string; quantity: string; rate: string }[];
};
type PurchaseOrder = {
  id: string; poNumber: number; status: string; orderDate: string; supplierId: string; grandTotal: string;
};
type GoodsReceipt = {
  id: string; receiptNumber: number; status: string; postingDate: string; supplierId: string;
  items: { id: string; quantity: string }[];
};
type Vendor = { id: string; vendorName: string };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline", submitted: "secondary", approved: "default", sent: "secondary",
  completed: "default", partially_received: "secondary", cancelled: "destructive",
};

const VALID_TABS = ["requisitions", "rfqs", "quotations", "purchase-orders", "goods-receipts"] as const;
type ProcurementTab = (typeof VALID_TABS)[number];

// Which of the six concurrent data sources backs which tab, so a source that
// fails independently names itself instead of a failed fetch rendering the
// same "No X yet." empty-state copy a real outage would also produce --
// same R43 F_032 convention PROJEXA's own ProcurementClient.tsx documents.
type LoadKey = "requisitions" | "rfqs" | "quotations" | "purchaseOrders" | "goodsReceipts" | "vendors";

export default function ProcurementPage() {
  const router = useRouter();
  const currencies = useCurrencies();
  const [activeTab, setActiveTab] = useState<ProcurementTab>("requisitions");
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [goodsReceipts, setGoodsReceipts] = useState<GoodsReceipt[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<Partial<Record<LoadKey, string>>>({});
  const [converting, setConverting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErrors({});

    const sources: {
      key: LoadKey; url: string; respKey: string; label: string; setter: (v: never[]) => void;
    }[] = [
      { key: "requisitions", url: "/api/v1/projexa/procurement/requisitions", respKey: "requisitions", label: "Requisitions", setter: setRequisitions as (v: never[]) => void },
      { key: "rfqs", url: "/api/v1/projexa/procurement/rfqs", respKey: "rfqs", label: "RFQs", setter: setRfqs as (v: never[]) => void },
      { key: "quotations", url: "/api/v1/projexa/procurement/quotations", respKey: "quotations", label: "Quotations", setter: setQuotations as (v: never[]) => void },
      { key: "purchaseOrders", url: "/api/v1/projexa/procurement/purchase-orders", respKey: "purchaseOrders", label: "Purchase orders", setter: setPurchaseOrders as (v: never[]) => void },
      { key: "goodsReceipts", url: "/api/v1/projexa/procurement/goods-receipts", respKey: "goodsReceipts", label: "Goods receipts", setter: setGoodsReceipts as (v: never[]) => void },
      { key: "vendors", url: "/api/v1/projexa/vendors", respKey: "vendors", label: "Vendors", setter: setVendors as (v: never[]) => void },
    ];

    const results = await Promise.allSettled(
      sources.map(async (s) => {
        const res = await fetch(s.url);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `Couldn't load ${s.label.toLowerCase()} (HTTP ${res.status})`);
        return body;
      }),
    );

    const errors: Partial<Record<LoadKey, string>> = {};
    results.forEach((result, i) => {
      const s = sources[i];
      if (result.status === "fulfilled") {
        s.setter(((result.value[s.respKey] as never[]) ?? []) as never[]);
      } else {
        errors[s.key] = result.reason instanceof Error ? result.reason.message : `Couldn't load ${s.label.toLowerCase()}`;
      }
    });

    setLoading(false);
    if (Object.keys(errors).length > 0) {
      setLoadErrors(errors);
      toast.error("Some procurement data couldn't be loaded");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.vendorName ?? id;
  const money = (n: string | number) => `${currencyLabel(undefined, currencies)}${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  // Real, already-working inline action -- no Object Page exists for
  // quotations, so this mirrors PROJEXA's own convertToPo() exactly,
  // against the same POST /api/v1/projexa/procurement/purchase-orders
  // createPurchaseOrder alias (raw shape: supplierId, not vendorId).
  async function convertToPo(q: Quotation) {
    setConverting(q.id);
    try {
      const res = await fetch("/api/v1/projexa/procurement/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: q.supplierId,
          orderDate: new Date().toISOString().slice(0, 10),
          items: q.items.map((i) => ({
            itemId: i.itemId ?? undefined, description: i.description,
            quantity: Number(i.quantity), rate: Number(i.rate),
          })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't convert quotation to a purchase order");
      toast.success("Purchase order created from quotation");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't convert quotation to a purchase order");
    } finally {
      setConverting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Procurement</h1>
        <p className="text-sm text-ct-muted mt-1">Requisition &rarr; RFQ &rarr; Quotation &rarr; Purchase Order &rarr; Goods Receipt.</p>
      </div>

      {loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
      ) : (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ProcurementTab)}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="requisitions">1. Requisitions</TabsTrigger>
            <TabsTrigger value="rfqs">2. RFQs</TabsTrigger>
            <TabsTrigger value="quotations">3. Quotations</TabsTrigger>
            <TabsTrigger value="purchase-orders">4. Purchase Orders</TabsTrigger>
            <TabsTrigger value="goods-receipts">5. Goods Receipts</TabsTrigger>
          </TabsList>

          {/* Stage 1: Requisitions */}
          <TabsContent value="requisitions" className="space-y-3">
            <div className="flex justify-end">
              <Button
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
                onClick={() => router.push("/procurement/requisitions/new")}
              >
                <Plus className="size-4 mr-1" /> New Requisition
              </Button>
            </div>
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                {loadErrors.requisitions ? (
                  <div className="py-10 text-center space-y-3">
                    <p className="text-sm text-red-600">{loadErrors.requisitions}</p>
                    <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
                  </div>
                ) : requisitions.length === 0 ? (
                  <p className="py-10 text-center text-sm text-ct-muted">No purchase requisitions yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>#</TableHead><TableHead>Purpose</TableHead><TableHead>Items</TableHead><TableHead>Status</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {requisitions.map((r) => (
                        <TableRow key={r.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/procurement/requisitions/${r.id}`)}>
                          <TableCell className="font-medium text-ct-navy">PR-{r.requisitionNumber}</TableCell>
                          <TableCell className="text-ct-muted">{r.purpose ?? "—"}</TableCell>
                          <TableCell>{r.items?.length ?? 0}</TableCell>
                          <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status.replace(/_/g, " ")}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Stage 2: RFQs */}
          <TabsContent value="rfqs" className="space-y-3">
            <div className="flex justify-end">
              <Button
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
                onClick={() => router.push("/procurement/rfqs/new")}
              >
                <Plus className="size-4 mr-1" /> New RFQ
              </Button>
            </div>
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                {loadErrors.rfqs ? (
                  <div className="py-10 text-center space-y-3">
                    <p className="text-sm text-red-600">{loadErrors.rfqs}</p>
                    <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
                  </div>
                ) : rfqs.length === 0 ? (
                  <p className="py-10 text-center text-sm text-ct-muted">No RFQs yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>#</TableHead><TableHead>Items</TableHead><TableHead>Vendors invited</TableHead><TableHead>Status</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {rfqs.map((r) => (
                        <TableRow key={r.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/procurement/rfqs/${r.id}`)}>
                          <TableCell className="font-medium text-ct-navy">RFQ-{r.rfqNumber}</TableCell>
                          <TableCell>{r.items?.length ?? 0}</TableCell>
                          <TableCell>{r.suppliers?.length ?? 0}</TableCell>
                          <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status.replace(/_/g, " ")}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Stage 3: Quotations */}
          <TabsContent value="quotations" className="space-y-3">
            <div className="flex justify-end">
              <Button
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
                onClick={() => router.push("/procurement/quotations/new")}
              >
                <Plus className="size-4 mr-1" /> Record Quotation
              </Button>
            </div>
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                {loadErrors.quotations ? (
                  <div className="py-10 text-center space-y-3">
                    <p className="text-sm text-red-600">{loadErrors.quotations}</p>
                    <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
                  </div>
                ) : quotations.length === 0 ? (
                  <p className="py-10 text-center text-sm text-ct-muted">No supplier quotations recorded yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>#</TableHead><TableHead>Vendor</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
                    </TableHeader>
                    <TableBody>
                      {quotations.map((q) => {
                        const total = q.items?.reduce((sum, i) => sum + Number(i.quantity) * Number(i.rate), 0) ?? 0;
                        return (
                          <TableRow key={q.id}>
                            <TableCell className="font-medium text-ct-navy">SQ-{q.quotationNumber}</TableCell>
                            <TableCell className="text-ct-muted">{vendorName(q.supplierId)}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(total)}</TableCell>
                            <TableCell><Badge variant={STATUS_VARIANT[q.status] ?? "outline"}>{q.status.replace(/_/g, " ")}</Badge></TableCell>
                            <TableCell className="text-right">
                              <Button size="sm" variant="outline" disabled={converting === q.id} onClick={() => convertToPo(q)}>
                                {converting === q.id ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <ArrowRight className="size-3.5 mr-1" />}
                                Convert to PO
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Stage 4: Purchase Orders -- rows open the EXISTING global
              /purchase-orders/[id] Object Page (PR #1969), not a nested
              procurement/purchase-orders/[id] duplicate. See file header. */}
          <TabsContent value="purchase-orders" className="space-y-3">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => router.push("/purchase-orders/new")}>
                <Plus className="size-4 mr-1" /> New Purchase Order (direct)
              </Button>
            </div>
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                {loadErrors.purchaseOrders ? (
                  <div className="py-10 text-center space-y-3">
                    <p className="text-sm text-red-600">{loadErrors.purchaseOrders}</p>
                    <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
                  </div>
                ) : purchaseOrders.length === 0 ? (
                  <p className="py-10 text-center text-sm text-ct-muted">No purchase orders yet. Convert a quotation to create one.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>#</TableHead><TableHead>Vendor</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {purchaseOrders.map((po) => (
                        <TableRow key={po.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/purchase-orders/${po.id}`)}>
                          <TableCell className="font-medium text-ct-navy">PO-{po.poNumber}</TableCell>
                          <TableCell className="text-ct-muted">{vendorName(po.supplierId)}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(po.grandTotal)}</TableCell>
                          <TableCell><Badge variant={STATUS_VARIANT[po.status] ?? "outline"}>{po.status.replace(/_/g, " ")}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Stage 5: Goods Receipts */}
          <TabsContent value="goods-receipts" className="space-y-3">
            <div className="flex justify-end">
              <Button
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
                onClick={() => router.push("/procurement/goods-receipts/new")}
              >
                <Plus className="size-4 mr-1" /> New Goods Receipt
              </Button>
            </div>
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                {loadErrors.goodsReceipts ? (
                  <div className="py-10 text-center space-y-3">
                    <p className="text-sm text-red-600">{loadErrors.goodsReceipts}</p>
                    <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
                  </div>
                ) : goodsReceipts.length === 0 ? (
                  <p className="py-10 text-center text-sm text-ct-muted">No goods receipts recorded yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>#</TableHead><TableHead>Vendor</TableHead><TableHead>Items</TableHead><TableHead>Status</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {goodsReceipts.map((gr) => (
                        <TableRow key={gr.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/procurement/goods-receipts/${gr.id}`)}>
                          <TableCell className="font-medium text-ct-navy">GRN-{gr.receiptNumber}</TableCell>
                          <TableCell className="text-ct-muted">{vendorName(gr.supplierId)}</TableCell>
                          <TableCell>{gr.items?.length ?? 0}</TableCell>
                          <TableCell><Badge variant={STATUS_VARIANT[gr.status] ?? "outline"}>{gr.status.replace(/_/g, " ")}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
