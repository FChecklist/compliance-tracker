"use client";

export const dynamic = "force-dynamic";

// Wave 6 batch 2 (compliance-tracker/PROJEXA merge): change order detail +
// e-signature workflow page -- PROJEXA's own reference (ChangeOrdersClient.tsx)
// never split this into its own page (submit + signature-status lived
// inline in the list row/dialog); this repo's brief asked for a real
// [id] page, matching the scope/[id] BOQ detail-page precedent, since a
// change order carries real workflow depth (draft -> pending_approval via
// e-signature -> approved/rejected, never a direct status PATCH). Designed
// directly from construction-change-order-service.ts + the
// /signature-status route's own comments:
//   - Only a draft change order can be submitted (submitChangeOrderForApproval
//     enforces this server-side; this page just doesn't show the button
//     once status has moved on).
//   - There is no client-side approve/reject action anywhere on this page,
//     by design -- see change-orders/[id]/route.ts's own comment: the old
//     action:"approve"/"reject" PATCH branch let any caller flip status
//     with zero signature ever happening, and was removed as a genuine
//     integrity bypass. Approval/rejection happens automatically,
//     server-side, once every signer actually signs (or one declines) --
//     this page only displays that real progress via GET .../signature-status.
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Send, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type ChangeOrder = {
  id: string; number: number; title: string; description: string | null; reason: string | null;
  costImpact: string; scheduleImpactDays: number; status: string; createdAt: string;
};
type Signer = {
  name: string; email: string; status: string; signOrder: number | null;
  signedAt: string | null; declinedAt: string | null; declineReason: string | null;
};
type SignatureStatus = {
  signatureRequest: { id: string; status: string; title: string; completedAt: string | null; signers: Signer[] } | null;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-ct-cloud text-ct-muted",
  pending_approval: "bg-ct-saffron/20 text-ct-saffron",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

function signerIcon(status: string) {
  if (status === "signed") return <CheckCircle2 className="size-3.5 text-green-600" />;
  if (status === "declined") return <XCircle className="size-3.5 text-red-600" />;
  return <Clock className="size-3.5 text-ct-muted" />;
}

export default function ChangeOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const currencies = useCurrencies();
  const money = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const changeOrderId = params.id;

  const [co, setCo] = useState<ChangeOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [signatureStatus, setSignatureStatus] = useState<SignatureStatus | null>(null);
  const [signatureLoading, setSignatureLoading] = useState(false);

  const [submitOpen, setSubmitOpen] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadSignatureStatus = useCallback(async () => {
    setSignatureLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/change-orders/${changeOrderId}/signature-status`);
      if (!res.ok) throw new Error();
      setSignatureStatus(await res.json());
    } catch {
      // Non-fatal -- the detail card below just shows nothing extra.
    } finally {
      setSignatureLoading(false);
    }
  }, [changeOrderId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/change-orders/${changeOrderId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      const data: ChangeOrder = await res.json();
      setCo(data);
      if (data.status === "pending_approval" || data.status === "approved" || data.status === "rejected") {
        loadSignatureStatus();
      }
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to load change order");
    } finally {
      setLoading(false);
    }
  }, [changeOrderId, loadSignatureStatus]);

  useEffect(() => { load(); }, [load]);

  const submitForApproval = async () => {
    if (!signerName.trim() || !signerEmail.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/projexa/change-orders/${changeOrderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", signers: [{ name: signerName, email: signerEmail }] }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Sent for e-signature approval");
      setSubmitOpen(false); setSignerName(""); setSignerEmail("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to submit for approval");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!co) return <p className="text-sm text-ct-muted">Change order not found.</p>;

  return (
    <div className="space-y-4">
      <Link href="/change-orders" className="inline-flex items-center gap-1 text-xs text-ct-muted hover:text-ct-navy">
        <ArrowLeft className="size-3.5" /> Back to Change Orders
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">CO-{co.number}: {co.title}</h1>
            <Badge className={`text-xs border-0 ${STATUS_COLORS[co.status] ?? "bg-ct-cloud text-ct-muted"}`}>{co.status.replace(/_/g, " ")}</Badge>
          </div>
          <p className="text-sm text-ct-muted mt-1">Created {new Date(co.createdAt).toLocaleDateString()}</p>
        </div>
        {co.status === "draft" && (
          <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
            <Button size="sm" onClick={() => setSubmitOpen(true)} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              <Send className="size-3.5 mr-1.5" /> Send for Approval
            </Button>
            <DialogContent>
              <DialogHeader><DialogTitle>Send for E-Signature Approval</DialogTitle><DialogDescription>Real signing request with a tamper-evident audit trail -- the same workflow used for contracts. Approval happens automatically once the signer signs.</DialogDescription></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Signer Name</Label>
                  <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Signer Email</Label>
                  <Input type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={submitForApproval} disabled={submitting || !signerName.trim() || !signerEmail.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                  {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                  Send
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-4"><p className="text-xs text-ct-muted">Cost Impact</p><p className={`text-xl font-heading ${Number(co.costImpact) >= 0 ? "text-red-600" : "text-green-700"}`}>{money(Number(co.costImpact))}</p></CardContent></Card>
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-4"><p className="text-xs text-ct-muted">Schedule Impact</p><p className="text-xl font-heading text-ct-navy">{co.scheduleImpactDays > 0 ? `+${co.scheduleImpactDays} days` : co.scheduleImpactDays === 0 ? "None" : `${co.scheduleImpactDays} days`}</p></CardContent></Card>
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-4"><p className="text-xs text-ct-muted">Status</p><p className="text-xl font-heading text-ct-navy capitalize">{co.status.replace(/_/g, " ")}</p></CardContent></Card>
      </div>

      {(co.reason || co.description) && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {co.reason && <div><p className="text-xs font-semibold text-ct-muted uppercase mb-1">Reason</p><p className="text-sm text-ct-navy">{co.reason}</p></div>}
            {co.description && <div><p className="text-xs font-semibold text-ct-muted uppercase mb-1">Description</p><p className="text-sm text-ct-navy">{co.description}</p></div>}
          </CardContent>
        </Card>
      )}

      {co.status !== "draft" && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">E-Signature Progress</CardTitle></CardHeader>
          <CardContent>
            {signatureLoading ? (
              <p className="text-sm text-ct-muted">Checking signature status...</p>
            ) : !signatureStatus?.signatureRequest ? (
              <p className="text-sm text-ct-muted">No signature request found.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-ct-muted">
                  Request status: <span className="font-medium text-ct-navy">{signatureStatus.signatureRequest.status}</span>
                  {signatureStatus.signatureRequest.completedAt && ` -- completed ${new Date(signatureStatus.signatureRequest.completedAt).toLocaleString()}`}
                </p>
                <div className="space-y-2">
                  {signatureStatus.signatureRequest.signers.map((s, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-ct-border p-2.5">
                      <div className="flex items-center gap-2">
                        {signerIcon(s.status)}
                        <div>
                          <p className="text-sm text-ct-navy">{s.name}</p>
                          <p className="text-xs text-ct-muted">{s.email}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs capitalize text-ct-muted">{s.status}</p>
                        {s.signedAt && <p className="text-[10px] text-ct-muted">{new Date(s.signedAt).toLocaleString()}</p>}
                        {s.declinedAt && <p className="text-[10px] text-red-600">{s.declineReason ?? "Declined"}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
