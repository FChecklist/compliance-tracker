"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own PurchaseOrderCreateClient.tsx. Same fields PROJEXA's create
// screen collects (vendor, order date, expected delivery, company/office,
// currency + exchange rate, line items with an optional stock-item link).
// POSTs to the SAME POST /api/v1/projexa/purchase-orders this app's backend
// already serves (createPurchaseOrder in erp-buying-service.ts).
//
// A PO line's itemId is genuinely optional upstream (erp_purchase_order_items
// .itemId is nullable) -- construction buying is not all stock (subcontract
// labour, plant hire, professional fees, one-off consumables), so a line with
// no stock item is still valid and still posts, exactly as PROJEXA's own
// screen documents. The item picker itself reads the SAME
// GET /api/v1/projexa/inventory/items PROJEXA's own screen reads, and is
// rendered only when that list is non-empty -- an org with no item master
// (or an unreachable lookup) sees the form exactly as it would without a
// picker at all, matching PROJEXA's own "non-fatal, optional" convention.
//
// Rebuilt on this repo's own Card/Input/Select (matching
// src/app/(app)/customers/new/page.tsx, src/app/(app)/budgets/new/page.tsx),
// not PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Vendor = { id: string; vendorName: string };
type Company = { id: string; companyName: string; abbr: string | null };
type Currency = { id: string; code: string; name: string; symbol: string | null; isBaseCurrency: boolean };
/** Same shape PROJEXA's own screen reads off GET /api/v1/projexa/inventory/items. */
type ItemRow = { id: string; itemCode: string; itemName: string };
/** `itemId` is "" when the line is free text -- never required. */
type Line = { description: string; itemId: string; quantity: string; rate: string };

const NO_ITEM = "__none__";
const NO_COMPANY = "__none__";

function blankLine(): Line {
  return { description: "", itemId: "", quantity: "1", rate: "" };
}

export default function PurchaseOrderNewPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [companyId, setCompanyId] = useState(NO_COMPANY);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [currencyId, setCurrencyId] = useState("");
  const [exchangeRate, setExchangeRate] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/vendors").then((r) => r.json()).then((d) => setVendors(d.vendors ?? [])).catch(() => {});
    fetch("/api/v1/projexa/companies").then((r) => r.json()).then((d) => setCompanies(d.companies ?? [])).catch(() => {});
    fetch("/api/v1/projexa/currencies").then((r) => r.json()).then((d) => setCurrencies(d.currencies ?? [])).catch(() => {});
    // Same lookup PROJEXA's own PurchaseOrderCreateClient.tsx reads. A
    // failure is swallowed like its siblings here: the item link is
    // optional, so an unreachable item master must not block raising the
    // order.
    fetch("/api/v1/projexa/inventory/items").then((r) => r.json()).then((d) => setItems(d.items ?? [])).catch(() => {});
  }, []);

  const selectedCurrency = currencies.find((c) => c.id === currencyId);
  const needsExchangeRate = !!currencyId && !selectedCurrency?.isBaseCurrency;

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function create() {
    if (!vendorId || lines.some((l) => !l.description.trim() || !l.rate)) {
      toast.error("Vendor and every line's description/rate are required");
      return;
    }
    if (needsExchangeRate && (!exchangeRate || Number(exchangeRate) <= 0)) {
      toast.error("An exchange rate is required for a non-base currency");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId, orderDate, expectedDeliveryDate: expectedDeliveryDate || undefined,
          companyId: companyId === NO_COMPANY ? undefined : companyId,
          currencyId: currencyId || undefined, exchangeRate: currencyId ? Number(exchangeRate) : undefined,
          // itemId omitted, never sent as "", when the line is free text --
          // createPurchaseOrder writes itemId straight into the nullable
          // column, and an empty string there would be a dangling reference
          // rather than the honest null a free-text line deserves.
          items: lines.map((l) => ({
            description: l.description, itemId: l.itemId || undefined,
            quantity: Number(l.quantity) || 1, rate: Number(l.rate),
          })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't create purchase order");
      toast.success("Purchase order created");
      router.push(`/purchase-orders/${body.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create purchase order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Purchase Order</h1>
        <p className="text-sm text-ct-muted mt-1">Purchase Orders / New Purchase Order</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Order Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue placeholder={vendors.length ? "Select vendor" : "No vendors found"} /></SelectTrigger>
              <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Order Date</Label>
              <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Expected Delivery (optional)</Label>
              <Input type="date" value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.target.value)} />
            </div>
          </div>
          {companies.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Company / Office (optional)</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COMPANY}>Unattributed</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {currencies.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Currency (optional)</Label>
                <Select value={currencyId || "base"} onValueChange={(v) => setCurrencyId(v === "base" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Org base currency" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="base">Org base currency</SelectItem>
                    {currencies.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}{c.isBaseCurrency ? " (base)" : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {needsExchangeRate && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Exchange Rate (to base)</Label>
                  <Input type="number" step="0.0001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} placeholder="e.g. 83.25" />
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Line Items</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, blankLine()])}>
                <Plus className="size-3.5 mr-1" />Add Line
              </Button>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="flex-1" />
                {/* Rendered only when there is an item master to pick from --
                    an org with the inventory module unused, or the lookup
                    unreachable, sees the screen exactly as it was rather than
                    an empty dropdown. */}
                {items.length > 0 && (
                  <Select value={l.itemId || NO_ITEM} onValueChange={(v) => updateLine(i, { itemId: v === NO_ITEM ? "" : v })}>
                    <SelectTrigger className="w-48"><SelectValue placeholder="Stock item (optional)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ITEM}>No stock item</SelectItem>
                      {items.map((it) => <SelectItem key={it.id} value={it.id}>{it.itemName} ({it.itemCode})</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-20" />
                <Input placeholder="Rate" type="number" value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} className="w-28" />
                <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Trash2 className="size-4 text-red-500" />
                </Button>
              </div>
            ))}
            {items.length > 0 && (
              <p className="text-xs text-ct-muted">A line with no stock item is a free-text purchase — the order is valid, but a goods receipt against that line posts no stock.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/purchase-orders")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={create}
          disabled={submitting || !vendorId}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Creating..." : "Create Purchase Order"}
        </Button>
      </div>
    </div>
  );
}
