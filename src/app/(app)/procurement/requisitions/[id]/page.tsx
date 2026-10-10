"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own RequisitionObjectClient.tsx. Reads/writes the SAME
// GET /api/v1/projexa/procurement/requisitions/{id} + POST .../submit
// routes this app's backend already serves (getPurchaseRequisition/
// submitPurchaseRequisition in erp-procurement-workflow-service.ts). No
// generic Edit/Delete -- no updateRequisition() exists upstream, matching
// PROJEXA's own screen exactly.
//
// Real, pre-existing, deliberate constraint (not introduced by this port):
// submitPurchaseRequisition() requires a real session user (the route
// itself 400s for an API-key caller with no ctx.dbUser) -- the Submit
// button surfaces that message via toast if blocked.
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

type Requisition = {
  id: string; requisitionNumber: number; purpose: string | null; status: string; postingDate: string;
  items: { id: string; description: string; quantity: string; estimatedRate: string | null }[];
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline", submitted: "secondary", approved: "default",
};

export default function RequisitionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const requisitionId = params.id;

  const [req, setReq] = useState<Requisition | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/procurement/requisitions/${encodeURIComponent(requisitionId)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't load this requisition");
      setReq(body as Requisition);
      setLoadError(null);
    } catch (err) {
      setReq(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this requisition");
    } finally {
      setLoading(false);
    }
  }, [requisitionId]);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/projexa/procurement/requisitions/${encodeURIComponent(requisitionId)}/submit`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to submit requisition");
      toast.success("Requisition submitted");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit requisition (requires a real user session)");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !req) {
    return (
      <div className="space-y-3">
        <Link href="/procurement" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" />Back to Procurement
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Requisition not found."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  const isDraft = req.status === "draft";

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/procurement")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Procurement
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">PR-{req.requisitionNumber}</h1>
            <Badge variant={STATUS_VARIANT[req.status] ?? "outline"}>{req.status.replace(/_/g, " ")}</Badge>
          </div>
          {isDraft && (
            <Button size="sm" disabled={submitting} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={submit}>
              {submitting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Send className="size-3.5 mr-1" />}
              {submitting ? "Submitting..." : "Submit"}
            </Button>
          )}
        </div>
        <p className="text-sm text-ct-muted mt-1">
          Purpose: {req.purpose ?? "—"} &middot; Posting Date: {req.postingDate}
        </p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Line Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Description</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Estimated Rate</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {req.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.description}</TableCell>
                  <TableCell className="text-right">{i.quantity}</TableCell>
                  <TableCell className="text-right">{i.estimatedRate ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
