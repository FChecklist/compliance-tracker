"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own SalesOrderObjectClient.tsx -- line items (with per-item
// deliveredQuantity, tracking partial fulfillment), a status Select, and a
// Document Flow trace (SAP VBFA "Display Document Flow" equivalent:
// quotation -> this order -> invoice(s) -> payments/credit notes/returns).
//
// Real API contract check (route.ts + erp-selling-service.ts read before
// writing this file, not assumed from PROJEXA's own client): GET
// /api/v1/projexa/sales-order-document-flow/[id] does NOT return a bare
// array the way PROJEXA's own fetchJson<FlowNode[]> assumed -- it returns
// getSalesOrderDocumentFlow()'s real object shape
// { salesOrderId, soNumber, customerId, orderStatus, orderGrandTotal,
//   invoicedTotal, paidTotal, creditedTotal, outstandingTotal, nodeCount,
//   nodes: SalesOrderDocumentFlowNode[] }. This page reads `.nodes`, not the
// response itself, and additionally surfaces the real invoiced/paid/
// credited/outstanding rollup PROJEXA's own client never displayed.
//
// hrefFor only links to a doc type this session has already ported a real
// page for (quotation -> /quotations/[id], per the house scope decision not
// to build /quotations or /invoices here) -- sales_invoice/credit_note stay
// as plain non-navigable labels since /invoices' credit-notes route is
// /invoices/credit-notes/[id], not a general doc-type route, and
// payment_entry/sales_return have no PROJEXA-facing page in this repo at
// all. This avoids fabricating a link to a page that may not resolve.
//
// Rebuilt on this repo's own Card/Table/Button (matching
// src/app/(app)/quotations/[id]/page.tsx), not PROJEXA's own
// @fchecklist/veridian-ui-kit ObjectScreen.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type SalesOrderItem = { id: string; description: string; quantity: string; rate: string; amount: string; deliveredQuantity: string };
type SalesOrder = {
  id: string; soNumber: number; customerId: string | null; customerName: string | null;
  opportunityId: string | null; quotationId: string | null; projectId: string | null; companyId: string | null;
  orderDate: string; deliveryDate: string | null; status: string;
  currencyId: string | null; exchangeRate: string; grandTotal: string; items: SalesOrderItem[];
};
type FlowNode = { docType: string; docId: string; docNumber: string; date: string | null; amount: number; status: string; parentDocId: string | null };
type DocumentFlow = {
  orderStatus: string; orderGrandTotal: number; invoicedTotal: number; paidTotal: number; creditedTotal: number; outstandingTotal: number; nodeCount: number; nodes: FlowNode[];
};

const STATUS_OPTIONS = ["draft", "confirmed", "partially_fulfilled", "fulfilled", "cancelled"];
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", confirmed: "secondary", partially_fulfilled: "secondary", fulfilled: "default", cancelled: "destructive",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

// See the file header: only quotation has a real page at a predictable
// path in this repo. Everything else renders as a plain label, no link.
function hrefFor(node: FlowNode): string | null {
  return node.docType === "quotation" ? `/quotations/${node.docId}` : null;
}

export default function SalesOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const salesOrderId = params.id;
  const currencies = useCurrencies();

  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [flow, setFlow] = useState<DocumentFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/sales-orders/${encodeURIComponent(salesOrderId)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't load this sales order");
      setOrder(body as SalesOrder);
      setLoadError(null);

      // Document Flow is a secondary, non-fatal section -- a failure here
      // (e.g. requireErpEnabled rejecting a differently-scoped org) should
      // not take down the whole page.
      try {
        const flowRes = await fetch(`/api/v1/projexa/sales-order-document-flow/${encodeURIComponent(salesOrderId)}`);
        const flowBody = await flowRes.json().catch(() => null);
        setFlow(flowRes.ok ? (flowBody as DocumentFlow) : null);
      } catch {
        setFlow(null);
      }
    } catch (err) {
      setOrder(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this sales order");
    } finally {
      setLoading(false);
    }
  }, [salesOrderId]);

  useEffect(() => { void load(); }, [load]);

  async function updateStatus(status: string) {
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/v1/projexa/sales-orders/${encodeURIComponent(salesOrderId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to update sales order");
      toast.success(`Order → ${status.replace(/_/g, " ")}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update sales order");
    } finally {
      setStatusBusy(false);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !order) {
    return (
      <div className="space-y-3 p-6">
        <Link href="/sales-orders" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" />Back to Sales Orders
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Sales order not found."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  const label = currencyLabel(order.currencyId, currencies);
  const money = (v: number) => `${label}${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6 p-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/sales-orders")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Sales Orders
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">Sales Order SO-{order.soNumber}</h1>
            <Badge variant={STATUS_VARIANT[order.status] ?? "outline"} className="capitalize">{order.status.replace(/_/g, " ")}</Badge>
          </div>
        </div>
        <p className="text-sm text-ct-muted mt-1">
          Customer: {order.customerName ?? "—"} &middot; Order Date: {formatDate(order.orderDate)} &middot; Delivery Date: {order.deliveryDate ? formatDate(order.deliveryDate) : "—"}
          &middot; Grand Total: {money(Number(order.grandTotal))}
          {order.quotationId ? (
            <>
              {" "}&middot; From <Link href={`/quotations/${order.quotationId}`} className="text-ct-teal hover:underline">Quotation</Link>
            </>
          ) : null}
        </p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <span className="text-xs font-semibold text-ct-muted uppercase mr-1">Status</span>
          <Select value={order.status} onValueChange={updateStatus}>
            <SelectTrigger className="h-8 w-48" disabled={statusBusy}>
              {statusBusy ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Line Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead><TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Delivered</TableHead><TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.description}</TableCell>
                  <TableCell className="text-right">{Number(i.quantity).toLocaleString()}</TableCell>
                  <TableCell className="text-right">{Number(i.deliveredQuantity ?? 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right">{label}{Number(i.rate).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-right">{label}{Number(i.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
        <div className="flex justify-end gap-6 border-t px-4 py-3 text-sm">
          <div><span className="text-ct-muted">Grand Total: </span><span className="font-medium text-ct-navy">{money(Number(order.grandTotal))}</span></div>
        </div>
      </Card>

      {flow && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">Document Flow</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
              <div className="rounded-md border border-ct-border p-2">
                <div className="text-xs text-ct-muted uppercase">Invoiced</div>
                <div className="font-medium text-ct-navy">{money(flow.invoicedTotal)}</div>
              </div>
              <div className="rounded-md border border-ct-border p-2">
                <div className="text-xs text-ct-muted uppercase">Paid</div>
                <div className="font-medium text-ct-navy">{money(flow.paidTotal)}</div>
              </div>
              <div className="rounded-md border border-ct-border p-2">
                <div className="text-xs text-ct-muted uppercase">Credited</div>
                <div className="font-medium text-ct-navy">{money(flow.creditedTotal)}</div>
              </div>
              <div className="rounded-md border border-ct-border p-2">
                <div className="text-xs text-ct-muted uppercase">Outstanding</div>
                <div className="font-medium text-ct-navy">{money(flow.outstandingTotal)}</div>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Document</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {flow.nodes.map((node) => {
                  const href = hrefFor(node);
                  return (
                    <TableRow key={`${node.docType}-${node.docId}`} className={node.docId === salesOrderId ? "bg-ct-saffron/5" : undefined}>
                      <TableCell className="font-medium text-ct-navy">
                        {href ? <Link href={href} className="text-ct-teal hover:underline">{node.docNumber}</Link> : node.docNumber}
                        <span className="ml-1.5 text-xs text-ct-muted capitalize">({node.docType.replace(/_/g, " ")})</span>
                      </TableCell>
                      <TableCell className="text-ct-muted">{node.date ? formatDate(node.date) : "—"}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{node.status.replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="text-right">{money(node.amount)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
