"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own RfqObjectClient.tsx. Reads/writes the SAME
// GET /api/v1/projexa/procurement/rfqs/{id} + POST .../send +
// GET .../comparison routes this app's backend already serves (getRfq/
// sendRfq/compareQuotationsForRfq in erp-procurement-workflow-service.ts).
//
// Scoring criteria, negotiation rounds, and reverse auctions are real,
// separately-built capabilities in erp-procurement-workflow-service.ts that
// this port does NOT surface -- a genuinely separate depth wave beyond this
// page's scope, disclosed here rather than silently skipped (same
// disclosed cut PROJEXA's own RfqObjectClient.tsx documents).
//
// Rebuilt on this repo's own Card/Table (matching
// src/app/(app)/purchase-orders/[id]/page.tsx), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Rfq = {
  id: string; rfqNumber: number; status: string; postingDate: string;
  items: { id: string; description: string; quantity: string }[];
  suppliers: { supplierId: string }[];
};
type ComparisonRow = { id: string; quotationNumber: number; supplierId: string; total: number; weightedScore: number | null };
type Vendor = { id: string; vendorName: string };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline", sent: "secondary",
};

export default function RfqDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const rfqId = params.id;
  const currencies = useCurrencies();
  const label = currencyLabel(undefined, currencies);

  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [comparison, setComparison] = useState<ComparisonRow[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rfqRes, cmpRes, vendorRes] = await Promise.all([
        fetch(`/api/v1/projexa/procurement/rfqs/${encodeURIComponent(rfqId)}`),
        fetch(`/api/v1/projexa/procurement/rfqs/${encodeURIComponent(rfqId)}/comparison`).catch(() => null),
        fetch("/api/v1/projexa/vendors").catch(() => null),
      ]);
      const rfqBody = await rfqRes.json().catch(() => null);
      if (!rfqRes.ok) throw new Error(rfqBody?.error ?? "Couldn't load this RFQ");
      setRfq(rfqBody as Rfq);
      if (cmpRes && cmpRes.ok) {
        const cmpBody = await cmpRes.json().catch(() => ({}));
        setComparison(cmpBody.comparison ?? []);
      }
      if (vendorRes && vendorRes.ok) {
        const vendorBody = await vendorRes.json().catch(() => ({}));
        setVendors(vendorBody.vendors ?? []);
      }
      setLoadError(null);
    } catch (err) {
      setRfq(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this RFQ");
    } finally {
      setLoading(false);
    }
  }, [rfqId]);

  useEffect(() => { void load(); }, [load]);

  async function send() {
    setSending(true);
    try {
      const res = await fetch(`/api/v1/projexa/procurement/rfqs/${encodeURIComponent(rfqId)}/send`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to send RFQ");
      toast.success("RFQ sent to suppliers");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send RFQ");
    } finally {
      setSending(false);
    }
  }

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.vendorName ?? id;

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !rfq) {
    return (
      <div className="space-y-3">
        <Link href="/procurement" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" />Back to Procurement
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "RFQ not found."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  const isDraft = rfq.status === "draft";

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/procurement")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Procurement
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">RFQ-{rfq.rfqNumber}</h1>
            <Badge variant={STATUS_VARIANT[rfq.status] ?? "outline"}>{rfq.status.replace(/_/g, " ")}</Badge>
          </div>
          {isDraft && (
            <Button size="sm" disabled={sending} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={send}>
              {sending ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Send className="size-3.5 mr-1" />}
              {sending ? "Sending..." : "Send to Vendors"}
            </Button>
          )}
        </div>
        <p className="text-sm text-ct-muted mt-1">
          Posting Date: {rfq.postingDate} &middot; Vendors Invited: {rfq.suppliers.length}
        </p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Quantity</TableHead></TableRow></TableHeader>
            <TableBody>
              {rfq.items.map((i) => (
                <TableRow key={i.id}><TableCell className="font-medium">{i.description}</TableCell><TableCell className="text-right">{i.quantity}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Quotation Comparison</CardTitle></CardHeader>
        <CardContent className="p-0">
          {comparison.length === 0 ? (
            <p className="py-10 text-center text-sm text-ct-muted">No quotations received yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Vendor</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Weighted Score</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {comparison.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{vendorName(c.supplierId)}</TableCell>
                    <TableCell className="text-right tabular-nums">{label}{c.total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right">{c.weightedScore ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
