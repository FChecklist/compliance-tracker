"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own ItemObjectClient.tsx (src/app/(app)/inventory/items/[id]/
// page.tsx there). Reads the already-native GET
// /api/v1/projexa/inventory/items/[id] route (getItem in
// erp-stock-service.ts), surfacing standardBuyingRate/standardSellingRate/
// hsnSacCode/hasSerialNo -- fields createItem() has always accepted but
// this repo's Items tab never showed anywhere before this page existed.
//
// No Edit action, matching PROJEXA's own honest scope cut: no updateItem()
// exists anywhere in erp-stock-service.ts (confirmed by reading that file
// before writing this page), so there is no write path to call. This is a
// real, pre-existing gap in the backend, not something introduced here.
//
// Single-file "use client" page using useParams() (this repo's own
// established convention for a dynamic segment -- see
// src/app/(app)/vendors/[id]/page.tsx's header comment), matching the house
// shadcn Card layout, not PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Item = {
  id: string; itemCode: string; itemName: string; uom: string | null;
  standardBuyingRate: string | null; standardSellingRate: string | null;
  hasBatchNo: boolean; hasSerialNo: boolean; hsnSacCode: string | null;
};

export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const itemId = params.id;
  const router = useRouter();
  const currencies = useCurrencies();

  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/inventory/items/${itemId}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Couldn't load this item (HTTP ${res.status})`);
      setItem(body);
      setLoadError(null);
    } catch (err) {
      setItem(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this item");
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => { void load(); }, [load]);

  if (loadError) {
    return (
      <div className="space-y-3">
        <button onClick={() => router.push("/inventory?tab=items")} className="inline-flex items-center gap-1 text-xs text-ct-muted hover:underline">
          <ArrowLeft className="size-3.5" /> Inventory
        </button>
        <p role="alert" className="text-sm text-ct-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }
  if (loading || !item) {
    return <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  const label = currencyLabel(undefined, currencies);

  return (
    <div className="space-y-4">
      <div>
        <button onClick={() => router.push("/inventory?tab=items")} className="inline-flex items-center gap-1 text-xs text-ct-muted hover:underline mb-1">
          <ArrowLeft className="size-3.5" /> Inventory
        </button>
        <h1 className="text-2xl font-heading text-ct-navy">{item.itemName}</h1>
        <p className="text-sm text-ct-muted mt-1">{item.itemCode}</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Item Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div><p className="text-xs text-ct-muted uppercase">UOM</p><p className="text-ct-navy">{item.uom ?? "—"}</p></div>
          <div><p className="text-xs text-ct-muted uppercase">HSN/SAC Code</p><p className="text-ct-navy">{item.hsnSacCode ?? "—"}</p></div>
          <div><p className="text-xs text-ct-muted uppercase">Standard Buying Rate</p><p className="text-ct-navy">{item.standardBuyingRate ? `${label}${Number(item.standardBuyingRate).toLocaleString()}` : "—"}</p></div>
          <div><p className="text-xs text-ct-muted uppercase">Standard Selling Rate</p><p className="text-ct-navy">{item.standardSellingRate ? `${label}${Number(item.standardSellingRate).toLocaleString()}` : "—"}</p></div>
          <div><p className="text-xs text-ct-muted uppercase">Batch Tracked</p><p><Badge variant={item.hasBatchNo ? "default" : "outline"}>{item.hasBatchNo ? "yes" : "no"}</Badge></p></div>
          <div><p className="text-xs text-ct-muted uppercase">Serial Tracked</p><p><Badge variant={item.hasSerialNo ? "default" : "outline"}>{item.hasSerialNo ? "yes" : "no"}</Badge></p></div>
        </CardContent>
      </Card>
    </div>
  );
}
