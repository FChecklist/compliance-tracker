"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own PurchaseOrderObjectClient.tsx (the Purchase Order Object
// Page: header facts, Submit, Receive Goods link, header-only Edit, and
// Cancel). Reads/writes the SAME GET/PATCH/DELETE
// /api/v1/projexa/procurement/purchase-orders/{id} and POST .../submit
// routes this app's backend already serves (getPurchaseOrder/
// updatePurchaseOrder/cancelPurchaseOrder/submitPurchaseOrder in
// erp-buying-service.ts) -- zero new backend route.
//
// Note the DIFFERENT backend route from the list/create pages: those use
// the vendor-shaped /api/v1/projexa/purchase-orders (supplierId aliased to
// vendorId), while this single-PO route returns the SERVICE's raw row
// (supplierId, not vendorId) -- confirmed by reading both route files
// directly rather than assuming a shared shape. PROJEXA's own two clients
// (PurchaseOrdersClient.tsx vs PurchaseOrderObjectClient.tsx) have this
// exact same split, proxying to two different VERIDIAN routes.
//
// Real Delete = real Cancel (cancelPurchaseOrder, status -> 'cancelled'),
// the same convention PurchaseOrderObjectClient.tsx documents and this
// port's sibling budgets/[id]/customers/[id] pages already follow. Both
// Edit and Cancel are draft-only, refused upstream with a 409 (also
// covering "a goods receipt already points at this order", which the
// status check alone cannot see) -- that sentence is what the toast shows.
//
// Line items are NOT editable here -- upstream's updatePurchaseOrder is
// header-only (grandTotal is derived from lines at create time), matching
// PROJEXA's own screen exactly.
//
// Rebuilt on this repo's own Card/Table/Select (matching
// src/app/(app)/budgets/[id]/page.tsx, src/app/(app)/customers/[id]/page.tsx),
// not PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, PackageCheck, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type PurchaseOrder = {
  id: string; poNumber: number; status: string; orderDate: string; expectedDeliveryDate: string | null;
  supplierId: string; companyId: string | null; projectId: string | null;
  currencyId: string | null; exchangeRate: string; grandTotal: string;
  items: { id: string; description: string; quantity: string; rate: string; amount: string }[];
};
type Vendor = { id: string; vendorName: string };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline", submitted: "secondary", partially_received: "secondary", completed: "default", cancelled: "destructive",
};

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const poId = params.id;
  const currencies = useCurrencies();
  const money = (n: string | number) => `${currencyLabel(undefined, currencies)}${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ supplierId: "", orderDate: "", expectedDeliveryDate: "" });
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [poRes, vendorRes] = await Promise.all([
        fetch(`/api/v1/projexa/procurement/purchase-orders/${encodeURIComponent(poId)}`),
        fetch("/api/v1/projexa/vendors").catch(() => null),
      ]);
      const poBody = await poRes.json().catch(() => null);
      if (!poRes.ok) throw new Error(poBody?.error ?? "Couldn't load this purchase order");
      setPo(poBody as PurchaseOrder);
      if (vendorRes && vendorRes.ok) {
        const vendorBody = await vendorRes.json().catch(() => ({}));
        setVendors(vendorBody.vendors ?? []);
      }
      setLoadError(null);
    } catch (err) {
      setPo(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this purchase order");
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/projexa/procurement/purchase-orders/${encodeURIComponent(poId)}/submit`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to submit purchase order");
      toast.success("Purchase order submitted");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit purchase order");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit() {
    if (!po) return;
    setDraft({
      supplierId: po.supplierId,
      orderDate: po.orderDate?.slice(0, 10) ?? "",
      expectedDeliveryDate: po.expectedDeliveryDate?.slice(0, 10) ?? "",
    });
    setMode("edit");
  }

  async function saveEdit() {
    if (!draft.supplierId || !draft.orderDate) { toast.error("Vendor and order date are required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/projexa/procurement/purchase-orders/${encodeURIComponent(poId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: draft.supplierId,
          orderDate: draft.orderDate,
          // Cleared in the form means cleared on the record -- null, not "".
          expectedDeliveryDate: draft.expectedDeliveryDate || null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to save purchase order");
      toast.success("Purchase order saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save purchase order");
    } finally {
      setSaving(false);
    }
  }

  async function cancelPo() {
    if (!po) return;
    const sentence = `Cancel PO-${po.poNumber}? This is a cancellation, not a row delete: it stays on file as 'cancelled', closed to Submit and Receive Goods. This cannot be undone.`;
    if (!confirm(sentence)) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/v1/projexa/procurement/purchase-orders/${encodeURIComponent(poId)}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to cancel purchase order");
      toast.success("Purchase order cancelled");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel purchase order");
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !po) {
    return (
      <div className="space-y-3">
        <Link href="/purchase-orders" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" />Back to Purchase Orders
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Purchase order not found."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  const isDraft = po.status === "draft";
  const vendorName = vendors.find((v) => v.id === po.supplierId)?.vendorName ?? po.supplierId ?? "—";
  const missingRequired = !draft.supplierId || !draft.orderDate;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/purchase-orders")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Purchase Orders
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">{mode === "edit" ? `Edit PO-${po.poNumber}` : `PO-${po.poNumber}`}</h1>
            <Badge variant={STATUS_VARIANT[po.status] ?? "outline"}>{po.status.replace(/_/g, " ")}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {mode === "display" && isDraft && (
              <Button variant="outline" size="sm" onClick={startEdit}>Edit</Button>
            )}
            {mode === "display" && isDraft && (
              <Button
                size="sm" disabled={submitting}
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
                onClick={submit}
              >
                {submitting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Send className="size-3.5 mr-1" />}
                {submitting ? "Submitting..." : "Submit"}
              </Button>
            )}
            {/* A cancelled PO is a dead end -- receiving against it would post
                stock for an order that was withdrawn.
                Deviation from PROJEXA's own screen, documented rather than
                faked: PROJEXA links to its own /procurement/goods-receipts/
                new?poId= (a dedicated create route that pre-fills the PO).
                This repo's native GRN screen (src/app/(app)/erp/goods-receipt
                /page.tsx) has no such route -- it is a single dialog-based
                page that lets the user pick the PO from its own "New Goods
                Receipt" dialog, with no poId query-param support. This links
                to that list/dialog screen instead of a non-existent route;
                the PO still has to be re-selected there by number. */}
            {mode === "display" && !isDraft && po.status !== "cancelled" && (
              <Button
                variant="outline" size="sm"
                onClick={() => router.push("/erp/goods-receipt")}
              >
                <PackageCheck className="size-3.5 mr-1" /> Receive Goods
              </Button>
            )}
            {mode === "display" && isDraft && (
              <Button
                variant="outline" size="sm" disabled={cancelling}
                className="text-red-700 border-red-200 hover:bg-red-50"
                onClick={cancelPo}
              >
                {cancelling ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
                Cancel Purchase Order
              </Button>
            )}
          </div>
        </div>
        {mode === "display" && (
          <p className="text-sm text-ct-muted mt-1">
            Vendor: {vendorName} &middot; Order Date: {po.orderDate} &middot; Expected Delivery: {po.expectedDeliveryDate ?? "—"} &middot; Grand Total: {money(po.grandTotal)}
          </p>
        )}
      </div>

      {mode === "edit" && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">Order Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Vendor</Label>
              <Select value={draft.supplierId} onValueChange={(v) => setDraft((d) => ({ ...d, supplierId: v }))}>
                <SelectTrigger><SelectValue placeholder={vendors.length ? "Pick a vendor" : "Loading…"} /></SelectTrigger>
                <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Order Date</Label>
                <Input type="date" value={draft.orderDate} onChange={(e) => setDraft((d) => ({ ...d, orderDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Expected Delivery (optional)</Label>
                <Input type="date" value={draft.expectedDeliveryDate} onChange={(e) => setDraft((d) => ({ ...d, expectedDeliveryDate: e.target.value }))} />
              </div>
            </div>
            <p className="text-xs text-ct-muted">Line items are not editable here — a purchase order&apos;s lines are fixed at create.</p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setMode("display")} disabled={saving}>Cancel</Button>
              <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={saveEdit} disabled={saving || missingRequired}>
                {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : null} Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Line Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.description}</TableCell>
                  <TableCell className="text-right">{i.quantity}</TableCell>
                  <TableCell className="text-right">{money(i.rate)}</TableCell>
                  <TableCell className="text-right">{money(i.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
