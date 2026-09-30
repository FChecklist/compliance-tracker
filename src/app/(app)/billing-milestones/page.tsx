"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA merge, module 18/24 (compliance-tracker/PROJEXA merge): Sumeet
// requirement #3 ("BILLING MILESTONES") -- the real create/draft/submit/
// approve/reject/invoice write UI for constructionProgressClaims. The
// already-ported Project 360 Analysis page only ever showed a read-only
// count tile; this is the real UI behind it. Ported from PROJEXA's own
// page.tsx + BillingMilestonesClient.tsx onto this repo's own established
// list+Dialog+ProjectPicker shell (same convention as change-orders/rfis,
// this session's other multi-stage-lifecycle ports), rather than PROJEXA's
// own two-file server/client split -- every already-merged construction
// page in this repo is a single "use client" page that owns its own project
// selection via ProjectPicker + /api/projects.
//
// State machine (construction-billing-workflow-service.ts's own
// CLAIM_TRANSITIONS table, enforced server-side, never re-implemented
// here): milestone_achieved -> drafted -> submitted -> client_approved ->
// invoiced, or submitted -> rejected -> drafted (redraft). No delete
// anywhere -- a rejected claim is redrafted, never removed, and an invoiced
// claim is terminal but stays in the list forever (append-only, same as
// milestones/change orders).
//
// Deliberate deviation from PROJEXA's own reference: PROJEXA fetches
// GET /api/reports/boq-analysis to read `row.boqId` and gate the "New
// Billing Milestone" button on an approved BOQ existing. In this repo that
// report route (src/app/api/v1/projexa/reports/boq-analysis/route.ts) is
// gated at role floor "manager" (profit-margin data), stricter than
// billing-claims' own "member" write floor -- porting that call 1:1 would
// have silently blocked every "member"-role user from ever creating a
// milestone, not just from seeing margin. Instead this page lists the
// project's BOQs via GET /api/v1/projexa/scope (a thin re-export of
// /api/v1/construction/boq, no role floor beyond plain auth) and resolves
// the approved one client-side with the exact same rule
// boq-contract-value-service.ts's resolveApprovedBoq() uses server-side
// (status === "approved", highest version wins).
import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, Receipt, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";

type ClaimStatus = "milestone_achieved" | "drafted" | "submitted" | "client_approved" | "invoiced" | "rejected";

type Claim = {
  id: string;
  customerId: string;
  milestoneDescription: string;
  scheduledDate: string;
  retentionPercent: string;
  status: ClaimStatus;
  rejectionReason: string | null;
  interimBillId: string | null;
};

type Customer = { id: string; customerName: string };
type TaxTemplate = { id: string; name: string };
type TimelineStep = { stage: string; at: string | null; note?: string };
type Timeline = { steps: TimelineStep[]; isStuck: boolean; daysSinceLastStep: number };
type Boq = { id: string; status: string; version: number };

const STATUS_LABEL: Record<ClaimStatus, string> = {
  milestone_achieved: "Milestone Achieved",
  drafted: "Drafted",
  submitted: "Submitted",
  client_approved: "Client Approved",
  invoiced: "Invoiced",
  rejected: "Rejected",
};

const STATUS_COLORS: Record<ClaimStatus, string> = {
  milestone_achieved: "bg-ct-cloud text-ct-muted",
  drafted: "bg-ct-cloud text-ct-muted",
  submitted: "bg-ct-saffron/20 text-ct-saffron-text",
  client_approved: "bg-ct-saffron/20 text-ct-saffron-text",
  invoiced: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

const NAME_REQUIRED = "Milestone description is required";
const CUSTOMER_REQUIRED = "Customer is required";
// GAP FOUND (PROJEXA's own comment on BillingMilestonesClient.tsx, ported
// verbatim): the backend route (POST /api/v1/projexa/billing-claims ->
// createProgressClaim) has always required scheduledDate, but a client-side
// guard that never checked for it would only surface as a toast error with
// the form left open -- same inline Save-button guidance as the other two
// required fields closes that gap here too.
const SCHEDULED_DATE_REQUIRED = "Scheduled date is required";
const NO_APPROVED_BOQ_REASON = "This project has no approved BOQ yet -- a billing milestone needs one to bill against.";

function resolveApprovedBoqId(boqs: Boq[]): string | null {
  const approved = boqs.filter((b) => b.status === "approved");
  if (approved.length === 0) return null;
  return [...approved].sort((a, b) => b.version - a.version)[0]!.id;
}

export default function BillingMilestonesPage() {
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [claims, setClaims] = useState<Claim[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [taxTemplates, setTaxTemplates] = useState<TaxTemplate[]>([]);
  const [boqId, setBoqId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [timelines, setTimelines] = useState<Record<string, Timeline>>({});

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [milestoneDescription, setMilestoneDescription] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [retentionPercent, setRetentionPercent] = useState("0");

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [invoicingId, setInvoicingId] = useState<string | null>(null);
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [taxTemplateId, setTaxTemplateId] = useState("");

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: PickerProject[] = d.projects ?? [];
        setProjects(list);
        if (list.length > 0) setProjectId((prev) => prev || list[0].id);
      })
      .catch(() => toast.error("Failed to load projects"))
      .finally(() => setLoadingProjects(false));
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [claimsRes, customersRes, boqsRes] = await Promise.all([
        fetch(`/api/v1/projexa/billing-claims?projectId=${encodeURIComponent(projectId)}&all=true`).then((r) => r.json()),
        fetch("/api/v1/projexa/customers").then((r) => r.json()),
        fetch(`/api/v1/projexa/scope?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()),
      ]);
      setClaims(claimsRes.claims ?? []);
      setCustomers(customersRes.customers ?? []);
      setBoqId(resolveApprovedBoqId(boqsRes.boqs ?? []));
    } catch {
      toast.error("Failed to load billing milestones");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/v1/projexa/tax-templates")
      .then((r) => r.json())
      .then((d) => setTaxTemplates(d.taxTemplates ?? []))
      .catch(() => setTaxTemplates([])); // ERP may not be enabled for this org -- invoicing simply stays unavailable, not a page-breaking error.
  }, []);

  function customerName(id: string): string {
    return customers.find((c) => c.id === id)?.customerName ?? id;
  }

  async function createClaim() {
    if (!milestoneDescription.trim() || !customerId || !boqId || !scheduledDate) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/projexa/billing-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, boqId, customerId,
          milestoneDescription: milestoneDescription.trim(),
          scheduledDate,
          retentionPercent: Number(retentionPercent) || 0,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Billing milestone created");
      setMilestoneDescription(""); setCustomerId(""); setScheduledDate(""); setRetentionPercent("0");
      setOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "The billing milestone was not created");
    } finally {
      setSaving(false);
    }
  }

  async function transition(claimId: string, action: "draft" | "submit" | "approve" | "reject" | "invoice", extra: Record<string, unknown> = {}) {
    setBusyId(claimId);
    try {
      const res = await fetch(`/api/v1/projexa/billing-claims/${encodeURIComponent(claimId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success(`Billing milestone ${action === "draft" ? "drafted" : action === "submit" ? "submitted" : action === "approve" ? "approved" : action === "reject" ? "rejected" : "invoiced"}`);
      setRejectingId(null); setRejectionReason("");
      setInvoicingId(null); setTaxTemplateId("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't update the billing milestone");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleTimeline(claimId: string) {
    if (expandedId === claimId) { setExpandedId(null); return; }
    setExpandedId(claimId);
    if (!timelines[claimId]) {
      try {
        const res = await fetch(`/api/v1/projexa/billing-claims/${encodeURIComponent(claimId)}`);
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
        const timeline: Timeline = await res.json();
        setTimelines((prev) => ({ ...prev, [claimId]: timeline }));
      } catch {
        toast.error("Couldn't load this milestone's timeline");
      }
    }
  }

  const saveDisabledReason = !milestoneDescription.trim()
    ? NAME_REQUIRED
    : !customerId
      ? CUSTOMER_REQUIRED
      : !scheduledDate
        ? SCHEDULED_DATE_REQUIRED
        : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Billing Milestones</h1>
          <p className="text-sm text-ct-muted mt-1">Progress claims against a project&apos;s approved BOQ -- draft, submit, get client approval, then invoice. Nothing here is ever deleted.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
              disabled={!projectId || !boqId}
              title={!boqId ? NO_APPROVED_BOQ_REASON : undefined}
            >
              <Plus className="size-4 mr-1" /> New Billing Milestone
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Billing Milestone</DialogTitle>
              <DialogDescription>Bills against this project&apos;s currently approved BOQ.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Customer</Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger><SelectValue placeholder="Select a customer..." /></SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Scheduled date</Label>
                  <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Retention %</Label>
                  <Input type="number" min={0} max={100} value={retentionPercent} onChange={(e) => setRetentionPercent(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Milestone description</Label>
                <Textarea value={milestoneDescription} onChange={(e) => setMilestoneDescription(e.target.value)} rows={3} placeholder="e.g. Foundation complete, ready to bill" />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={createClaim}
                disabled={saving || !!saveDisabledReason}
                title={saveDisabledReason}
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
              >
                {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                {saveDisabledReason ? `Save (${saveDisabledReason})` : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={Receipt} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : claims.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No billing milestones yet for this project.</CardContent>
            </Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Milestone</TableHead><TableHead>Customer</TableHead><TableHead>Scheduled</TableHead>
                      <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.map((c) => {
                      const busy = busyId === c.id;
                      const expanded = expandedId === c.id;
                      return (
                        <Fragment key={c.id}>
                          <TableRow>
                            <TableCell className="font-medium text-ct-navy max-w-xs">
                              <button
                                type="button"
                                className="flex items-start gap-1.5 text-left hover:underline underline-offset-2"
                                onClick={() => toggleTimeline(c.id)}
                              >
                                {expanded ? <ChevronDown className="size-3.5 mt-0.5 shrink-0" /> : <ChevronRight className="size-3.5 mt-0.5 shrink-0" />}
                                <span>{c.milestoneDescription}</span>
                              </button>
                              {c.status === "rejected" && c.rejectionReason && (
                                <p className="text-xs text-red-600 mt-1 pl-5">Rejected: {c.rejectionReason}</p>
                              )}
                            </TableCell>
                            <TableCell className="text-ct-muted">{customerName(c.customerId)}</TableCell>
                            <TableCell className="text-ct-muted">{c.scheduledDate}</TableCell>
                            <TableCell><Badge className={`text-xs border-0 ${STATUS_COLORS[c.status]}`}>{STATUS_LABEL[c.status]}</Badge></TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                {(c.status === "milestone_achieved" || c.status === "rejected") && (
                                  <Button size="sm" variant="outline" disabled={busy} onClick={() => transition(c.id, "draft")}>
                                    {c.status === "rejected" ? "Redraft" : "Draft"}
                                  </Button>
                                )}
                                {c.status === "drafted" && (
                                  <Button size="sm" variant="outline" disabled={busy} onClick={() => transition(c.id, "submit")}>Submit</Button>
                                )}
                                {c.status === "submitted" && (
                                  <>
                                    <Button size="sm" disabled={busy} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={() => transition(c.id, "approve")}>Approve</Button>
                                    <Button size="sm" variant="outline" disabled={busy} onClick={() => { setRejectingId(c.id); setRejectionReason(""); }}>Reject</Button>
                                  </>
                                )}
                                {c.status === "client_approved" && (
                                  <Button
                                    size="sm"
                                    className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
                                    disabled={busy || taxTemplates.length === 0}
                                    title={taxTemplates.length === 0 ? "No tax templates configured -- set one up in Accounting first" : undefined}
                                    onClick={() => { setInvoicingId(c.id); setTaxTemplateId(""); }}
                                  >
                                    Invoice
                                  </Button>
                                )}
                                {c.status === "invoiced" && c.interimBillId && (
                                  <Button size="sm" variant="ghost" asChild>
                                    <Link href="/erp/invoicing">View invoice</Link>
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                          {expanded && (
                            <TableRow className="bg-ct-cloud/30 hover:bg-ct-cloud/30">
                              <TableCell colSpan={5} className="py-3">
                                {!timelines[c.id] ? (
                                  <Loader2 className="size-4 animate-spin text-ct-muted" />
                                ) : (
                                  <ul className="space-y-1 text-xs text-ct-muted pl-5">
                                    {timelines[c.id]!.steps.map((s) => (
                                      <li key={s.stage}>
                                        <span className="font-medium text-ct-navy capitalize">{s.stage.replace(/_/g, " ")}</span>: {s.at ? new Date(s.at).toLocaleString() : "not yet"}
                                        {s.note ? ` -- ${s.note}` : ""}
                                      </li>
                                    ))}
                                    {timelines[c.id]!.isStuck && (
                                      <li className="text-red-600">No progress in {timelines[c.id]!.daysSinceLastStep} days -- follow up.</li>
                                    )}
                                  </ul>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={!!rejectingId} onOpenChange={(v) => !v && setRejectingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject billing milestone</DialogTitle>
            <DialogDescription>The claim returns to draft so it can be corrected and resubmitted.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Reason</Label>
            <Input value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} placeholder="e.g. Client disputes quantities" />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={busyId === rejectingId}
              onClick={() => rejectingId && transition(rejectingId, "reject", { rejectionReason })}
            >
              Confirm reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!invoicingId} onOpenChange={(v) => !v && setInvoicingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invoice billing milestone</DialogTitle>
            <DialogDescription>Generates the interim bill and sales invoice for this claim.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Bill date</Label>
              <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Tax template</Label>
              <Select value={taxTemplateId} onValueChange={setTaxTemplateId}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {taxTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={busyId === invoicingId || !billDate || !taxTemplateId}
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
              onClick={() => invoicingId && transition(invoicingId, "invoice", { billDate, taxTemplateId })}
            >
              Confirm invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
