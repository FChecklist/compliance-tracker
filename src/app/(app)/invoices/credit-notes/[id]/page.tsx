"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own CreditNoteObjectClient.tsx. Reads/writes the SAME
// GET /api/v1/projexa/credit-notes/{id} and POST .../submit routes this
// app's backend already serves (getSalesCreditNote/submitSalesCreditNote
// in erp-credit-note-service.ts) -- zero new backend route.
//
// No Delete/Cancel button here, matching PROJEXA's own screen exactly --
// there is no cancelSalesCreditNote() anywhere in erp-credit-note-
// service.ts (confirmed by reading that file directly before writing this
// page), so no button is offered rather than faking one. This is a real,
// documented gap versus a full lifecycle, not an oversight.
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type NoteItem = { id: string; description: string; quantity: string; rate: string; amount: string };
type CreditNote = {
  id: string; creditNoteNumber: number; customerId: string; customerName: string | null; salesInvoiceId: string | null;
  postingDate: string; reason: string | null; status: string; totalAmount: string; items: NoteItem[];
};

const STATUS_VARIANT: Record<string, "default" | "outline"> = { draft: "outline", submitted: "default" };

export default function CreditNoteDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const noteId = params.id;
  const currencies = useCurrencies();
  const money = (v: string | number) => `${currencyLabel(undefined, currencies)}${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  const [note, setNote] = useState<CreditNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/credit-notes/${encodeURIComponent(noteId)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't load this credit note");
      setNote(body as CreditNote);
      setLoadError(null);
    } catch (err) {
      setNote(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this credit note");
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => { void load(); }, [load]);

  async function submitNote() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/projexa/credit-notes/${encodeURIComponent(noteId)}/submit`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to submit credit note");
      toast.success("Credit note submitted");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit credit note");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !note) {
    return (
      <div className="space-y-3">
        <Link href="/invoices?tab=credit-notes" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" />Back to Credit Notes
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Credit note not found."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/invoices?tab=credit-notes")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Credit Notes
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-heading text-ct-navy">Credit Note #{note.creditNoteNumber}</h1>
          <Badge variant={STATUS_VARIANT[note.status] ?? "outline"} className="capitalize">{note.status}</Badge>
        </div>
        <p className="text-sm text-ct-muted mt-1">
          Customer: {note.customerName ?? "—"} &middot; Posting Date: {note.postingDate} &middot; Reason: {note.reason ?? "—"} &middot; Total: {money(note.totalAmount)}
          {note.salesInvoiceId ? <> &middot; Against Invoice: {note.salesInvoiceId}</> : null}
        </p>
      </div>

      {note.status === "draft" && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">Submit</CardTitle></CardHeader>
          <CardContent>
            <Button size="sm" disabled={submitting} onClick={submitNote} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {submitting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Send className="size-3.5 mr-1" />}
              {submitting ? "Submitting…" : "Submit"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Line Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {note.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.description}</TableCell>
                  <TableCell className="text-right">{Number(i.quantity).toLocaleString()}</TableCell>
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
