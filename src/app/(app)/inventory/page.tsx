"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own Inventory overview (src/app/(app)/inventory/page.tsx +
// InventoryClient.tsx there -- 3 tabs: Stock Balance, Warehouses, Items).
// Reads the already-native GET /api/v1/projexa/inventory/{items,warehouses,
// stock-balance} routes -- thin aliases over erp-stock-service.ts's
// listItems/listWarehouses and erp-inventory-service.ts's listStockBalances
// (verified field-for-field against each route.ts before writing this
// file) -- zero new backend route, zero HTTP hop to a separate origin.
//
// UI is compliance-tracker's own shadcn Tabs/Table/Card (matching the house
// convention every already-ported PROJEXA-merge page uses -- see
// src/app/(app)/employees/page.tsx for the same URL-synced-tab +
// Promise.allSettled pattern this file follows), not PROJEXA's
// @fchecklist/veridian-ui-kit ScreenFrame. Porting the DATA and BEHAVIOUR,
// not the exact component tree. Real create routes (items/new,
// stock-entries/new, warehouses/new) rather than Dialog popups, matching
// PROJEXA's own 2026-08-30 "real-screen conversion" of this exact module.
//
// New top-level route: no /inventory page existed in compliance-tracker
// before this (confirmed via a repo-wide check before writing this file).
//
// One deliberate addition beyond PROJEXA's own reference page: the
// Warehouses tab also shows a "Parent" column (resolved client-side from
// the same warehouses list already loaded) -- erp_warehouses.
// parentWarehouseId is real data the list endpoint already returns, and
// PROJEXA's own screen collects a parent on create (WarehouseCreateClient)
// but never displays it anywhere afterwards. A small, honest improvement,
// not a fabricated feature.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plus, Warehouse, ArrowDownToLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type WarehouseRow = { id: string; warehouseName: string; parentWarehouseId: string | null };
type ItemRow = { id: string; itemCode: string; itemName: string; uom: string | null; hasBatchNo: boolean };
type Balance = {
  itemId: string; warehouseId: string; qty: number; value: number; averageCost: number;
  itemCode: string | null; itemName: string | null; uom: string | null; warehouseName: string | null;
};

const VALID_TABS = new Set(["balances", "warehouses", "items"]);

async function fetchOk<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Couldn't load ${what} (HTTP ${res.status})`);
  return body as T;
}

function InventoryPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currencies = useCurrencies();
  const initialTab = searchParams.get("tab");
  const [activeTab, setActiveTabState] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "balances");

  function setActiveTab(next: string) {
    setActiveTabState(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);
  // Keyed by dataset, not a flat list: each tab panel has to be able to tell
  // "this is genuinely empty" from "this call failed", so no panel can render
  // an empty state where an error belongs -- same convention PROJEXA's own
  // InventoryClient.tsx and this repo's employees/page.tsx both use.
  const [loadErrors, setLoadErrors] = useState<{ warehouses?: string; items?: string; balances?: string }>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [wh, item, bal] = await Promise.allSettled([
      fetchOk<{ warehouses?: WarehouseRow[] }>("/api/v1/projexa/inventory/warehouses", "warehouses"),
      fetchOk<{ items?: ItemRow[] }>("/api/v1/projexa/inventory/items", "items"),
      fetchOk<{ balances?: Balance[] }>("/api/v1/projexa/inventory/stock-balance", "stock balance"),
    ]);

    const errors: { warehouses?: string; items?: string; balances?: string } = {};
    if (wh.status === "fulfilled") setWarehouses(wh.value.warehouses ?? []);
    else { setWarehouses([]); errors.warehouses = wh.reason instanceof Error ? wh.reason.message : "Couldn't load warehouses"; }

    if (item.status === "fulfilled") setItems(item.value.items ?? []);
    else { setItems([]); errors.items = item.reason instanceof Error ? item.reason.message : "Couldn't load items"; }

    if (bal.status === "fulfilled") setBalances(bal.value.balances ?? []);
    else { setBalances([]); errors.balances = bal.reason instanceof Error ? bal.reason.message : "Couldn't load stock balance"; }

    setLoadErrors(errors);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const warehouseName = (id: string | null) => warehouses.find((w) => w.id === id)?.warehouseName ?? "—";
  const money = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Inventory</h1>
          <p className="text-sm text-ct-muted mt-1">Stock items, warehouses, and on-hand balances across your organisation.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => router.push("/inventory/warehouses/new")}>
            <Warehouse className="size-4 mr-1" /> New Warehouse
          </Button>
          <Button variant="outline" onClick={() => router.push("/inventory/items/new")}>
            <Plus className="size-4 mr-1" /> New Item
          </Button>
          <Button
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
            onClick={() => router.push("/inventory/stock-entries/new")}
          >
            <ArrowDownToLine className="size-4 mr-1" /> Record Stock Movement
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="balances">Stock Balance</TabsTrigger>
            <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
            <TabsTrigger value="items">Items</TabsTrigger>
          </TabsList>

          {Object.values(loadErrors).some(Boolean) && (
            <Card role="alert" className="rounded-xl border-ct-error bg-red-50">
              <CardContent className="space-y-2 p-4 text-sm text-ct-error">
                <ul className="list-disc space-y-0.5 pl-5">
                  {Object.values(loadErrors).filter(Boolean).map((m) => <li key={m}>{m}</li>)}
                </ul>
                <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
              </CardContent>
            </Card>
          )}

          <TabsContent value="balances">
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                {loadErrors.balances ? null : balances.length === 0 ? (
                  <p className="py-10 text-center text-sm text-ct-muted">No stock on hand yet. Record a receipt to get started.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Item</TableHead><TableHead>Warehouse</TableHead><TableHead>Qty</TableHead><TableHead>Avg. Cost</TableHead><TableHead>Value</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {balances.map((b) => (
                        <TableRow key={`${b.itemId}-${b.warehouseId}`}>
                          <TableCell className="font-medium text-ct-navy">
                            {b.itemName ?? b.itemId} {b.itemCode ? <span className="text-ct-muted">({b.itemCode})</span> : null}
                          </TableCell>
                          <TableCell className="text-ct-muted">{b.warehouseName ?? b.warehouseId}</TableCell>
                          <TableCell>{b.qty.toLocaleString()} {b.uom ?? ""}</TableCell>
                          <TableCell>{money(b.averageCost)}</TableCell>
                          <TableCell>{money(b.value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="warehouses">
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                {loadErrors.warehouses ? null : warehouses.length === 0 ? (
                  <p className="py-10 text-center text-sm text-ct-muted">No warehouses yet.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Warehouse Name</TableHead><TableHead>Parent</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {warehouses.map((w) => (
                        <TableRow key={w.id}>
                          <TableCell className="font-medium text-ct-navy">{w.warehouseName}</TableCell>
                          <TableCell className="text-ct-muted">{w.parentWarehouseId ? warehouseName(w.parentWarehouseId) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="items">
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                {loadErrors.items ? null : items.length === 0 ? (
                  <p className="py-10 text-center text-sm text-ct-muted">No items yet.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>UOM</TableHead><TableHead>Batch Tracked</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {items.map((i) => (
                        <TableRow key={i.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/inventory/items/${i.id}`)}>
                          <TableCell className="font-medium text-ct-navy">{i.itemCode}</TableCell>
                          <TableCell>{i.itemName}</TableCell>
                          <TableCell className="text-ct-muted">{i.uom ?? "—"}</TableCell>
                          <TableCell><Badge variant={i.hasBatchNo ? "default" : "outline"}>{i.hasBatchNo ? "yes" : "no"}</Badge></TableCell>
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

export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-ct-muted" /></div>}>
      <InventoryPageInner />
    </Suspense>
  );
}
