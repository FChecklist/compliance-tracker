"use client";

export const dynamic = "force-dynamic";

// Wave 6 batch 1 (compliance-tracker/PROJEXA merge): BOQ detail/workflow
// page -- the one piece of this wave with genuinely no reference UI to port
// (PROJEXA's own ScopeClient.tsx never wired up approve/compare/revisions/
// submit despite the backend fully supporting all four; the module-mapping
// report flagged this explicitly as "zero UI exists anywhere"). Designed
// directly from construction-boq-service.ts's contract:
//   - submitBoq: draft -> submitted only.
//   - approveBoq: submitted -> approved only, requires role >= manager
//     server-side (requireRole in the approve route) AND rejects
//     self-approval (isSelfApproval(boq.createdById, userId)) -- this page
//     does not attempt to replicate either check client-side, it just
//     surfaces whatever error the API returns via toast. A user who can't
//     approve simply sees the button fail with a clear message rather than
//     the button being conditionally hidden, since this page has no cheap
//     way to know the viewer's role/identity relationship to the BOQ's
//     creator without an extra /api/me round trip this wave didn't add.
//   - compareBoq: only meaningful once a parentBoqId exists (a revision) --
//     the "Compare to Previous" action is hidden otherwise, matching the
//     API's own 400 ("This BOQ has no previous revision to compare
//     against") rather than surfacing that error.
//   - createBoqRevision: takes a full lineItems array (not a diff) and
//     creates a new draft version, marking the current one "superseded".
//     Available regardless of current status (the service itself places no
//     status restriction on it) -- pre-filled with the current line items
//     so revising means editing existing rows, not retyping the BOQ.
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Trash2, GitCompare, CheckCircle2, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type LineItem = {
  id: string; itemCode: string | null; description: string; unit: string;
  quantity: string; rate: string; amount: string; computedRate: number | null;
};
type Boq = {
  id: string; projectId: string; version: number; title: string; status: string;
  parentBoqId: string | null; createdAt: string; lineItems: LineItem[];
};
type LineItemDraft = { description: string; unit: string; quantity: string; rate: string };
type Comparison = {
  added: LineItem[]; removed: LineItem[];
  changed: { key: string; previous: LineItem; current: LineItem; quantityChange: number; rateChange: number; netVariation: number }[];
  warnings: string[];
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-ct-cloud text-ct-muted",
  submitted: "bg-ct-saffron/20 text-ct-saffron",
  approved: "bg-green-100 text-green-700",
  superseded: "bg-red-100 text-red-700",
};

const toDraft = (items: LineItem[]): LineItemDraft[] =>
  items.length > 0
    ? items.map((i) => ({ description: i.description, unit: i.unit, quantity: i.quantity, rate: i.rate }))
    : [{ description: "", unit: "", quantity: "", rate: "" }];

export default function ScopeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const currencies = useCurrencies();
  const boqId = params.id;

  const [boq, setBoq] = useState<Boq | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<"submit" | "approve" | null>(null);

  const [compareOpen, setCompareOpen] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [comparing, setComparing] = useState(false);

  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionTitle, setRevisionTitle] = useState("");
  const [revisionLines, setRevisionLines] = useState<LineItemDraft[]>([]);
  const [revisionSubmitting, setRevisionSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/construction/boq/${boqId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      const data: Boq = await res.json();
      setBoq(data);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to load BOQ");
    } finally {
      setLoading(false);
    }
  }, [boqId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setActionLoading("submit");
    try {
      const res = await fetch(`/api/construction/boq/${boqId}/submit`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("BOQ submitted for approval");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to submit BOQ");
    } finally {
      setActionLoading(null);
    }
  };

  const approve = async () => {
    setActionLoading("approve");
    try {
      const res = await fetch(`/api/construction/boq/${boqId}/approve`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("BOQ approved");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to approve BOQ -- you may need manager rank or an independent approver");
    } finally {
      setActionLoading(null);
    }
  };

  const openCompare = async () => {
    setCompareOpen(true);
    setComparing(true);
    try {
      const res = await fetch(`/api/construction/boq/${boqId}/compare`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      setComparison(await res.json());
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to compare BOQ revisions");
      setCompareOpen(false);
    } finally {
      setComparing(false);
    }
  };

  const openRevisionDialog = () => {
    if (!boq) return;
    setRevisionTitle(boq.title);
    setRevisionLines(toDraft(boq.lineItems));
    setRevisionOpen(true);
  };

  const updateRevisionLine = (index: number, field: keyof LineItemDraft, value: string) => {
    setRevisionLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };

  const createRevision = async () => {
    const validLines = revisionLines.filter((l) => l.description.trim() && l.unit.trim() && l.quantity && l.rate);
    if (validLines.length === 0) {
      toast.error("Add at least one complete line item");
      return;
    }
    setRevisionSubmitting(true);
    try {
      const res = await fetch(`/api/construction/boq/${boqId}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: revisionTitle || undefined,
          lineItems: validLines.map((l) => ({ description: l.description, unit: l.unit, quantity: Number(l.quantity), rate: Number(l.rate) })),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      const newBoq: Boq = await res.json();
      toast.success(`Revision v${newBoq.version} created`);
      setRevisionOpen(false);
      router.push(`/scope/${newBoq.id}`);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to create revision");
    } finally {
      setRevisionSubmitting(false);
    }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!boq) return <p className="text-sm text-ct-muted">BOQ not found.</p>;

  const total = boq.lineItems.reduce((sum, i) => sum + Number(i.amount), 0);

  return (
    <div className="space-y-4">
      <Link href="/scope" className="inline-flex items-center gap-1 text-xs text-ct-muted hover:text-ct-navy">
        <ArrowLeft className="size-3.5" /> Back to Scope
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">{boq.title}</h1>
            <Badge className={`text-xs border-0 ${STATUS_COLORS[boq.status] ?? "bg-ct-cloud text-ct-muted"}`}>{boq.status}</Badge>
          </div>
          <p className="text-sm text-ct-muted mt-1">Version {boq.version} &middot; created {new Date(boq.createdAt).toLocaleDateString()}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {boq.parentBoqId && (
            <Button size="sm" variant="outline" onClick={openCompare}>
              <GitCompare className="size-3.5 mr-1.5" /> Compare to Previous
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={openRevisionDialog}>
            <Plus className="size-3.5 mr-1.5" /> Create Revision
          </Button>
          {boq.status === "draft" && (
            <Button size="sm" onClick={submit} disabled={actionLoading !== null} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {actionLoading === "submit" ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Send className="size-3.5 mr-1.5" />}
              Submit for Approval
            </Button>
          )}
          {boq.status === "submitted" && (
            <Button size="sm" onClick={approve} disabled={actionLoading !== null} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {actionLoading === "approve" ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="size-3.5 mr-1.5" />}
              Approve
            </Button>
          )}
        </div>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Line Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          {boq.lineItems.length === 0 ? (
            <p className="py-10 text-center text-sm text-ct-muted">No line items.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boq.lineItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-ct-navy">
                      {item.description}
                      {item.itemCode && <span className="ml-2 font-mono text-[10px] text-ct-muted">{item.itemCode}</span>}
                    </TableCell>
                    <TableCell className="text-ct-muted">{item.unit}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">
                      {currencyLabel(undefined, currencies)}{Number(item.rate).toLocaleString()}
                      {item.computedRate != null && (
                        <span className="ml-1.5 text-[10px] text-ct-muted">(buildup {currencyLabel(undefined, currencies)}{item.computedRate.toLocaleString()})</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium text-ct-navy">{currencyLabel(undefined, currencies)}{Number(item.amount).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {boq.lineItems.length > 0 && (
          <div className="px-4 py-3 border-t border-ct-border flex justify-end">
            <p className="text-sm font-semibold text-ct-navy">Total: {currencyLabel(undefined, currencies)}{total.toLocaleString()}</p>
          </div>
        )}
      </Card>

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Compare to Previous Revision</DialogTitle><DialogDescription>Diffed against this BOQ's immediate parent version.</DialogDescription></DialogHeader>
          {comparing ? (
            <div className="grid h-24 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
          ) : comparison ? (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              {comparison.warnings.length > 0 && (
                <div className="rounded-lg border border-ct-saffron/40 bg-ct-saffron/10 p-3 space-y-1">
                  {comparison.warnings.map((w, i) => <p key={i} className="text-xs text-ct-saffron">{w}</p>)}
                </div>
              )}
              {comparison.added.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-ct-muted uppercase mb-1.5">Added ({comparison.added.length})</p>
                  <div className="space-y-1">
                    {comparison.added.map((i) => <p key={i.id} className="text-sm text-ct-navy">{i.description} -- {i.quantity} {i.unit} @ {currencyLabel(undefined, currencies)}{Number(i.rate).toLocaleString()}</p>)}
                  </div>
                </div>
              )}
              {comparison.removed.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-ct-muted uppercase mb-1.5">Removed ({comparison.removed.length})</p>
                  <div className="space-y-1">
                    {comparison.removed.map((i) => <p key={i.id} className="text-sm text-ct-muted line-through">{i.description}</p>)}
                  </div>
                </div>
              )}
              {comparison.changed.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-ct-muted uppercase mb-1.5">Changed ({comparison.changed.length})</p>
                  <div className="space-y-2">
                    {comparison.changed.map((c) => (
                      <div key={c.key} className="text-sm">
                        <p className="text-ct-navy font-medium">{c.current.description}</p>
                        <p className="text-xs text-ct-muted">
                          Qty {c.previous.quantity} &rarr; {c.current.quantity} ({c.quantityChange >= 0 ? "+" : ""}{c.quantityChange}), Rate {c.previous.rate} &rarr; {c.current.rate}, Net {c.netVariation >= 0 ? "+" : ""}{currencyLabel(undefined, currencies)}{c.netVariation.toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {comparison.added.length === 0 && comparison.removed.length === 0 && comparison.changed.length === 0 && (
                <p className="text-sm text-ct-muted">No differences from the previous revision.</p>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Create Revision</DialogTitle><DialogDescription>Creates version {boq.version + 1} as a new draft; this version becomes superseded.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
              <Input value={revisionTitle} onChange={(e) => setRevisionTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Line Items</Label>
              {revisionLines.map((line, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_90px_100px_28px] gap-2">
                  <Input placeholder="Description" value={line.description} onChange={(e) => updateRevisionLine(i, "description", e.target.value)} />
                  <Input placeholder="Unit" value={line.unit} onChange={(e) => updateRevisionLine(i, "unit", e.target.value)} />
                  <Input placeholder="Qty" type="number" value={line.quantity} onChange={(e) => updateRevisionLine(i, "quantity", e.target.value)} />
                  <Input placeholder="Rate" type="number" value={line.rate} onChange={(e) => updateRevisionLine(i, "rate", e.target.value)} />
                  <Button variant="ghost" size="icon" onClick={() => setRevisionLines((prev) => prev.filter((_, idx) => idx !== i))} disabled={revisionLines.length === 1}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setRevisionLines((prev) => [...prev, { description: "", unit: "", quantity: "", rate: "" }])}>
                <Plus className="size-3.5 mr-1" /> Add Line
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={createRevision} disabled={revisionSubmitting} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {revisionSubmitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Create Revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
