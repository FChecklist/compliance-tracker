"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own SalesQuotationObjectClient.tsx -- status transitions
// (draft -> pending_approval -> approved -> sent -> lost|expired, matching
// the real QUOTATION_TRANSITIONS table in erp-selling-service.ts), New
// Revision, Download PDF and Convert to Sales Order. Reads/writes the SAME
// GET/PATCH /api/v1/projexa/quotations/{id}, POST .../revisions,
// GET .../pdf and POST .../convert routes this app's backend already
// serves -- zero new backend route.
//
// Real, pre-existing, deliberate constraint (not introduced here, see
// [id]/route.ts's own long comment): the pending_approval -> approved
// transition specifically requires a real session user at manager rank --
// PROJEXA's shared API-key proxy cannot do this at all, but this page calls
// the route directly with the logged-in user's own session, so Approve
// works here whenever the logged-in user actually holds manager rank. Every
// other transition (submit/reject/mark sent/mark lost/mark expired, plus
// revision/convert) only requires ordinary member access.
//
// Rebuilt on this repo's own Card/Table/Button (matching
// src/app/(app)/invoices/[id]/page.tsx), not PROJEXA's own
// @fchecklist/veridian-ui-kit ObjectScreen.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ArrowRightCircle, Copy, FileDown, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type QuotationItem = { id: string; description: string; quantity: string; rate: string; amount: string };
type Quotation = {
  id: string; quotationNumber: number; customerId: string | null; customerName: string | null;
  quotationDate: string; validTill: string | null; status: string; version: number; revisionOf: string | null;
  currencyId: string | null; exchangeRate: string; grandTotal: string; items: QuotationItem[];
};

const NEXT_ACTIONS: Record<string, { label: string; status: string }[]> = {
  draft: [{ label: "Submit for Approval", status: "pending_approval" }],
  pending_approval: [{ label: "Approve", status: "approved" }, { label: "Reject to Draft", status: "draft" }],
  approved: [{ label: "Mark Sent", status: "sent" }],
  sent: [{ label: "Mark Lost", status: "lost" }, { label: "Mark Expired", status: "expired" }],
  ordered: [], lost: [], expired: [],
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", pending_approval: "secondary", approved: "secondary", sent: "default", ordered: "default", lost: "destructive", expired: "destructive",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

export default function QuotationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const quotationId = params.id;
  const currencies = useCurrencies();

  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/quotations/${encodeURIComponent(quotationId)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't load this quotation");
      setQuotation(body as Quotation);
      setLoadError(null);
    } catch (err) {
      setQuotation(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this quotation");
    } finally {
      setLoading(false);
    }
  }, [quotationId]);

  useEffect(() => { void load(); }, [load]);

  async function transition(status: string) {
    setBusy(`status-${status}`);
    try {
      const res = await fetch(`/api/v1/projexa/quotations/${encodeURIComponent(quotationId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to update quotation status");
      toast.success(`Quotation → ${status.replace("_", " ")}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update quotation status");
    } finally {
      setBusy(null);
    }
  }

  async function createRevision() {
    setBusy("revision");
    try {
      const res = await fetch(`/api/v1/projexa/quotations/${encodeURIComponent(quotationId)}/revisions`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to create revision");
      toast.success(`Revision v${(quotation?.version ?? 1) + 1} created`);
      router.push(`/quotations/${body.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create revision");
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf() {
    setBusy("pdf");
    try {
      const res = await fetch(`/api/v1/projexa/quotations/${encodeURIComponent(quotationId)}/pdf`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Failed to generate quotation PDF");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quotation-${quotation?.quotationNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't download quotation PDF");
    } finally {
      setBusy(null);
    }
  }

  async function convertToOrder() {
    setBusy("convert");
    try {
      const res = await fetch(`/api/v1/projexa/quotations/${encodeURIComponent(quotationId)}/convert`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderDate }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to convert quotation");
      toast.success("Converted to a sales order");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't convert quotation");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !quotation) {
    return (
      <div className="space-y-3 p-6">
        <Link href="/quotations" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" />Back to Quotations
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Quotation not found."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  const label = currencyLabel(quotation.currencyId, currencies);
  const canRevise = !["ordered", "lost", "expired"].includes(quotation.status);
  const nextActions = NEXT_ACTIONS[quotation.status] ?? [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/quotations")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Quotations
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">Quotation #{quotation.quotationNumber}</h1>
            <Badge variant={STATUS_VARIANT[quotation.status] ?? "outline"} className="capitalize">{quotation.status.replace(/_/g, " ")}</Badge>
          </div>
        </div>
        <p className="text-sm text-ct-muted mt-1">
          Customer: {quotation.customerName ?? "—"} &middot; Date: {formatDate(quotation.quotationDate)} &middot; Valid Till: {quotation.validTill ? formatDate(quotation.validTill) : "—"}
          &middot; Version: v{quotation.version}{quotation.revisionOf ? " (revision)" : ""} &middot; Grand Total: {label}{Number(quotation.grandTotal).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
        </p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          {nextActions.map((action) => (
            <Button
              key={action.status} size="sm" variant="outline" disabled={busy !== null}
              onClick={() => transition(action.status)}
            >
              {busy === `status-${action.status}` ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              {busy === `status-${action.status}` ? "Working…" : action.label}
            </Button>
          ))}
          {canRevise && (
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={createRevision} title="New revision">
              {busy === "revision" ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Copy className="size-3.5 mr-1" />}
              {busy === "revision" ? "Creating…" : "New Revision"}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={downloadPdf}>
            {busy === "pdf" ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <FileDown className="size-3.5 mr-1" />}
            {busy === "pdf" ? "Downloading…" : "Download PDF"}
          </Button>
        </CardContent>
      </Card>

      {quotation.status === "sent" && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">Convert to Sales Order</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Order Date</Label>
              <Input type="date" className="w-40" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
            <Button size="sm" disabled={busy !== null} onClick={convertToOrder} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {busy === "convert" ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <ArrowRightCircle className="size-3.5 mr-1" />}
              {busy === "convert" ? "Converting…" : "Convert to Sales Order"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Line Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Description</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {quotation.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.description}</TableCell>
                  <TableCell className="text-right">{Number(i.quantity).toLocaleString()}</TableCell>
                  <TableCell className="text-right">{label}{Number(i.rate).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-right">{label}{Number(i.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
        <div className="flex justify-end gap-6 border-t px-4 py-3 text-sm">
          <div><span className="text-ct-muted">Grand Total: </span><span className="font-medium text-ct-navy">{label}{Number(quotation.grandTotal).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></div>
        </div>
      </Card>
    </div>
  );
}
