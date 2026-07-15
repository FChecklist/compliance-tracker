"use client";

export const dynamic = "force-dynamic";

// THE FIRM AI OS practice cockpit (Wave 108 backend, wired to real routes +
// UI here). Consumes the 27 routes under /api/the-firm/* that wrap the
// pre-existing firm-*-service.ts business logic (billing rate resolution,
// invoice generation from unbilled time, staff utilization, tax-case
// limitation tracking, unified deadline aggregation) -- none of that logic
// is new, it was simply unreachable from any UI before this page existed.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Play, Square, Plus, CheckCircle2, IndianRupee, Briefcase } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Client = { id: string; name: string };
type StaffUser = { id: string; name: string };
type Engagement = { id: string; title: string; serviceLine: string; status: string; feeType: string; feeAmount: string | null; recurrenceType: string; budgetedHours: string | null; actualHours: number };
type Deliverable = { id: string; title: string; dueDate: string | null; status: string };
type TaxCase = { id: string; assessmentYear: string; caseType: string; forum: string; stage: string; dueDate: string | null; limitationDate: string | null };
type StaffAssignment = { id: string; userId: string; role: string; allocatedHoursPerWeek: string | null };
type TimeEntry = { id: string; taskDescription: string; hours: string; spentOn: string; billable: boolean; isRunning: boolean; invoiceLineItemId: string | null };
type Invoice = { id: string; invoiceNumber: string; issueDate: string; status: string; subtotal: string; totalAmount: string };
type Deadline = { source: string; id: string; clientId: string | null; title: string; dueDate: string };

const STAGE_COLORS: Record<string, string> = { notice_received: "bg-amber-100 text-amber-700", hearing: "bg-blue-100 text-blue-700", order_passed: "bg-ct-cloud text-ct-muted", appeal_filed: "bg-blue-100 text-blue-700", closed: "bg-green-100 text-green-700" };
const INVOICE_STATUS_COLORS: Record<string, string> = { draft: "bg-ct-cloud text-ct-muted", sent: "bg-blue-100 text-blue-700", paid: "bg-green-100 text-green-700", overdue: "bg-red-100 text-red-700", void: "bg-ct-cloud text-ct-muted" };
const SERVICE_LINES = ["ca_services", "cs_services", "legal_services", "grc_services", "audit_services"];

export default function TheFirmPracticePage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");

  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [taxCases, setTaxCases] = useState<TaxCase[]>([]);
  const [staffAssignments, setStaffAssignments] = useState<StaffAssignment[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  const [engagementOpen, setEngagementOpen] = useState(false);
  const [engTitle, setEngTitle] = useState(""); const [engServiceLine, setEngServiceLine] = useState("ca_services");
  const [engFeeType, setEngFeeType] = useState("fixed"); const [engFeeAmount, setEngFeeAmount] = useState(""); const [engStartDate, setEngStartDate] = useState("");
  const [engRecurrenceType, setEngRecurrenceType] = useState("none"); const [engBudgetedHours, setEngBudgetedHours] = useState("");

  const [taxCaseOpen, setTaxCaseOpen] = useState(false);
  const [tcYear, setTcYear] = useState(""); const [tcType, setTcType] = useState("scrutiny"); const [tcForum, setTcForum] = useState("ao");

  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [teDescription, setTeDescription] = useState(""); const [teHours, setTeHours] = useState(""); const [teDate, setTeDate] = useState(new Date().toISOString().slice(0, 10));

  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invNumber, setInvNumber] = useState(""); const [invIssueDate, setInvIssueDate] = useState(new Date().toISOString().slice(0, 10)); const [invThroughDate, setInvThroughDate] = useState(new Date().toISOString().slice(0, 10)); const [invTaxRate, setInvTaxRate] = useState("18");
  const [generating, setGenerating] = useState(false);

  const [portalLink, setPortalLink] = useState<string | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);

  const loadEnablement = useCallback(() => {
    fetch("/api/the-firm/enablement").then(r => r.json()).then(d => setEnabled(!!d.isEnabled)).catch(() => setEnabled(false));
  }, []);
  useEffect(loadEnablement, [loadEnablement]);

  const loadBaseData = useCallback(() => {
    Promise.all([fetch("/api/clients"), fetch("/api/users"), fetch("/api/the-firm/dashboard/deadlines?withinDays=30")])
      .then(([c, u, d]) => Promise.all([c.json(), u.json(), d.json()]))
      .then(([c, u, d]) => { setClients(c.clients ?? []); setStaff(u.users ?? []); setDeadlines(d.deadlines ?? []); })
      .catch(() => {});
  }, []);
  useEffect(() => { if (enabled) loadBaseData(); }, [enabled, loadBaseData]);

  const loadClientData = useCallback((clientId: string) => {
    if (!clientId) { setEngagements([]); setTaxCases([]); setStaffAssignments([]); setInvoices([]); return; }
    Promise.all([
      fetch(`/api/the-firm/clients/${clientId}/engagements`), fetch(`/api/the-firm/clients/${clientId}/tax-cases`),
      fetch(`/api/the-firm/clients/${clientId}/staff-assignments`), fetch(`/api/the-firm/clients/${clientId}/invoices`),
    ]).then(rs => Promise.all(rs.map(r => r.json())))
      .then(([e, t, s, i]) => { setEngagements(e.engagements ?? []); setTaxCases(t.taxCases ?? []); setStaffAssignments(s.assignments ?? []); setInvoices(i.invoices ?? []); })
      .catch(() => {});
    fetch(`/api/the-firm/time-entries?clientId=${clientId}`).then(r => r.json()).then(d => setTimeEntries(d.timeEntries ?? [])).catch(() => {});
  }, []);
  useEffect(() => { loadClientData(selectedClientId); }, [selectedClientId, loadClientData]);
  useEffect(() => { fetch("/api/the-firm/deliverables").then(r => r.json()).then(d => setDeliverables(d.deliverables ?? [])).catch(() => {}); }, [enabled]);

  const enableFirm = async () => {
    setEnabling(true);
    const res = await fetch("/api/the-firm/enablement", { method: "POST" });
    setEnabling(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to enable"); return; }
    toast.success("THE FIRM AI OS enabled");
    // Priority 18b (Owner directive 2026-07-15, Option B, auto-upgrade
    // Trigger B) -- same surface as PmsEnablementSection.tsx's identical
    // addition: surface both counts, never silently drop the "already
    // belongs elsewhere" information.
    const data: { stage0AutoUpgrade?: { upgraded: number; blocked: number } } = await res.json().catch(() => ({}));
    const su = data.stage0AutoUpgrade;
    if (su && su.upgraded > 0) toast.success(`${su.upgraded} stage-0 user${su.upgraded === 1 ? "" : "s"} auto-upgraded to full membership`);
    if (su && su.blocked > 0) toast.info(`${su.blocked} stage-0 user${su.blocked === 1 ? "" : "s"} could not auto-upgrade -- already belong to another organization`);
    setEnabled(true);
  };

  const createEngagement = async () => {
    if (!selectedClientId || !engTitle || !engStartDate) { toast.error("Client, title, and start date are required"); return; }
    const res = await fetch(`/api/the-firm/clients/${selectedClientId}/engagements`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: engTitle, serviceLine: engServiceLine, feeType: engFeeType, feeAmount: engFeeAmount ? Number(engFeeAmount) : null, startDate: engStartDate, recurrenceType: engRecurrenceType, budgetedHours: engBudgetedHours ? Number(engBudgetedHours) : null }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create engagement"); return; }
    toast.success("Engagement created"); setEngagementOpen(false); setEngTitle(""); setEngFeeAmount(""); setEngRecurrenceType("none"); setEngBudgetedHours(""); loadClientData(selectedClientId);
  };

  const createTaxCase = async () => {
    if (!selectedClientId || !tcYear) { toast.error("Client and assessment year are required"); return; }
    const res = await fetch(`/api/the-firm/clients/${selectedClientId}/tax-cases`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessmentYear: tcYear, caseType: tcType, forum: tcForum }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create tax case"); return; }
    toast.success("Tax case created"); setTaxCaseOpen(false); setTcYear(""); loadClientData(selectedClientId);
  };

  const advanceTaxCaseStage = async (caseId: string, stage: string) => {
    const res = await fetch(`/api/the-firm/tax-cases/${caseId}/stage`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }) });
    if (!res.ok) { toast.error("Failed to update stage"); return; }
    toast.success("Stage updated"); loadClientData(selectedClientId);
  };

  const generatePortalLink = async () => {
    if (!selectedClientId) return;
    setGeneratingLink(true);
    const res = await fetch(`/api/the-firm/clients/${selectedClientId}/portal-links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    setGeneratingLink(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create portal link"); return; }
    const d = await res.json();
    const url = `${window.location.origin}/client-portal/${d.link.token}`;
    setPortalLink(url);
    navigator.clipboard?.writeText(url).catch(() => {});
    toast.success("Portal link created and copied to clipboard (valid 30 days)");
  };

  const startTimer = async () => {
    if (!selectedClientId || !teDescription) { toast.error("Select a client and describe the task first"); return; }
    const res = await fetch("/api/the-firm/time-entries/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: selectedClientId, taskDescription: teDescription }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to start timer"); return; }
    toast.success("Timer started"); loadClientData(selectedClientId);
  };

  const stopTimer = async (id: string) => {
    const res = await fetch(`/api/the-firm/time-entries/${id}/stop`, { method: "POST" });
    if (!res.ok) { toast.error("Failed to stop timer"); return; }
    toast.success("Timer stopped"); loadClientData(selectedClientId);
  };

  const logManualEntry = async () => {
    if (!selectedClientId || !teDescription || !teHours) { toast.error("Description and hours are required"); return; }
    const res = await fetch("/api/the-firm/time-entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: selectedClientId, taskDescription: teDescription, hours: Number(teHours), spentOn: teDate }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to log time"); return; }
    toast.success("Time logged"); setManualEntryOpen(false); setTeDescription(""); setTeHours(""); loadClientData(selectedClientId);
  };

  const generateInvoice = async () => {
    if (!selectedClientId || !invNumber) { toast.error("Invoice number is required"); return; }
    setGenerating(true);
    const res = await fetch(`/api/the-firm/clients/${selectedClientId}/invoices`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceNumber: invNumber, issueDate: invIssueDate, throughDate: invThroughDate, taxRatePercent: invTaxRate ? Number(invTaxRate) : null }),
    });
    setGenerating(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to generate invoice"); return; }
    toast.success("Invoice generated from unbilled time"); setInvoiceOpen(false); setInvNumber(""); loadClientData(selectedClientId);
  };

  const transitionInvoice = async (id: string, action: "send" | "paid" | "void") => {
    const res = await fetch(`/api/the-firm/invoices/${id}/${action}`, { method: "POST" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to update invoice"); return; }
    toast.success("Invoice updated"); loadClientData(selectedClientId);
  };

  if (enabled === null) {
    return <div className="p-8 text-center text-ct-muted"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading…</div>;
  }

  if (!enabled) {
    return (
      <div className="max-w-xl mx-auto mt-16">
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-8 text-center space-y-3">
            <Briefcase className="w-10 h-10 mx-auto text-ct-teal" />
            <h1 className="font-heading text-2xl text-ct-navy">THE FIRM AI OS</h1>
            <p className="text-sm text-ct-muted">Client roster, engagements, tax-case workflow, staff capacity, time tracking, and billing — for CA/CS/Legal/GRC/Audit practices. Not yet enabled for this organisation.</p>
            <Button onClick={enableFirm} disabled={enabling} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{enabling && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Enable THE FIRM AI OS</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const runningEntry = timeEntries.find(t => t.isRunning);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">THE FIRM — Practice Cockpit</h1>
        <p className="text-sm text-ct-muted mt-1">Client roster, engagements, tax cases, time tracking, and billing in one place</p>
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="engagements">Client & Engagements</TabsTrigger>
          <TabsTrigger value="taxcases">Tax Cases</TabsTrigger>
          <TabsTrigger value="billing">Time & Billing</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-4">
              <h3 className="font-heading text-lg text-ct-navy mb-3">Deadlines — next 30 days</h3>
              {deadlines.length === 0 ? <p className="text-sm text-ct-muted">Nothing due.</p> : (
                <div className="space-y-1.5">
                  {deadlines.map(d => (
                    <div key={`${d.source}-${d.id}`} className="flex items-center justify-between text-sm border-b border-ct-border pb-1.5">
                      <span className="text-ct-navy">{d.title}</span>
                      <div className="flex items-center gap-2"><Badge className="bg-ct-cloud text-ct-muted text-xs">{d.source.replace(/_/g, " ")}</Badge><span className="text-ct-muted text-xs">{d.dueDate}</span></div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-4">
              <h3 className="font-heading text-lg text-ct-navy mb-3">Upcoming Deliverables</h3>
              {deliverables.length === 0 ? <p className="text-sm text-ct-muted">No open deliverables.</p> : (
                <div className="space-y-1.5">
                  {deliverables.map(d => (
                    <div key={d.id} className="flex items-center justify-between text-sm border-b border-ct-border pb-1.5">
                      <span className="text-ct-navy">{d.title}</span>
                      <div className="flex items-center gap-2">{d.dueDate && <span className="text-ct-muted text-xs">{d.dueDate}</span>}<Badge className={d.status === "done" ? "bg-green-100 text-green-700" : "bg-ct-cloud text-ct-muted"}>{d.status}</Badge></div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="engagements" className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="w-72"><Label>Client</Label>
              <Select value={selectedClientId} onValueChange={(v) => { setSelectedClientId(v); setPortalLink(null); }}>
                <SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {selectedClientId && (
              <Button variant="outline" onClick={generatePortalLink} disabled={generatingLink}>{generatingLink && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Generate Client Portal Link</Button>
            )}
          </div>
          {portalLink && (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-3 text-xs text-ct-navy break-all">{portalLink} <span className="text-ct-muted">(copied to clipboard, valid 30 days)</span></CardContent></Card>
          )}

          {selectedClientId && (
            <>
              <Card className="rounded-xl shadow-card bg-white">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-heading text-lg text-ct-navy">Engagements</h3>
                    <Dialog open={engagementOpen} onOpenChange={setEngagementOpen}>
                      <DialogTrigger asChild><Button size="sm" className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-3.5 h-3.5 mr-1" />New Engagement</Button></DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>New Engagement</DialogTitle></DialogHeader>
                        <div className="space-y-3">
                          <div><Label>Title</Label><Input value={engTitle} onChange={e => setEngTitle(e.target.value)} placeholder="FY26 Statutory Audit" /></div>
                          <div><Label>Service Line</Label>
                            <Select value={engServiceLine} onValueChange={setEngServiceLine}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>{SERVICE_LINES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="flex gap-3">
                            <div className="flex-1"><Label>Fee Type</Label>
                              <Select value={engFeeType} onValueChange={setEngFeeType}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="fixed">Fixed</SelectItem><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="retainer">Retainer</SelectItem></SelectContent>
                              </Select>
                            </div>
                            <div className="flex-1"><Label>Fee Amount (₹)</Label><Input type="number" value={engFeeAmount} onChange={e => setEngFeeAmount(e.target.value)} /></div>
                          </div>
                          <div><Label>Start Date</Label><Input type="date" value={engStartDate} onChange={e => setEngStartDate(e.target.value)} /></div>
                          <div className="flex gap-3">
                            <div className="flex-1"><Label>Recurrence</Label>
                              <Select value={engRecurrenceType} onValueChange={setEngRecurrenceType}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">One-off</SelectItem>
                                  <SelectItem value="monthly">Monthly</SelectItem>
                                  <SelectItem value="quarterly">Quarterly</SelectItem>
                                  <SelectItem value="half_yearly">Half-yearly</SelectItem>
                                  <SelectItem value="annually">Annually</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex-1"><Label>Budgeted Hours</Label><Input type="number" value={engBudgetedHours} onChange={e => setEngBudgetedHours(e.target.value)} /></div>
                          </div>
                          {engRecurrenceType !== "none" && <p className="text-xs text-ct-muted">A new engagement will be auto-generated each {engRecurrenceType.replace(/_/g, "-")} period after the start date.</p>}
                        </div>
                        <DialogFooter><Button onClick={createEngagement} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Create</Button></DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                  {engagements.length === 0 ? <p className="text-sm text-ct-muted">No engagements yet.</p> : (
                    <div className="space-y-1.5">
                      {engagements.map(e => (
                        <div key={e.id} className="flex items-center justify-between text-sm border-b border-ct-border pb-1.5">
                          <div>
                            <span className="text-ct-navy font-medium">{e.title}</span>
                            <span className="text-ct-muted text-xs ml-2">{e.serviceLine.replace(/_/g, " ")}</span>
                            {e.recurrenceType !== "none" && <Badge className="bg-blue-50 text-blue-700 ml-2">{e.recurrenceType.replace(/_/g, "-")}</Badge>}
                            {e.budgetedHours && (
                              <span className={`text-xs ml-2 ${e.actualHours > Number(e.budgetedHours) ? "text-red-600" : "text-ct-muted"}`}>
                                {e.actualHours.toFixed(1)}h / {Number(e.budgetedHours).toFixed(1)}h budgeted
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2"><span className="text-ct-muted text-xs">{e.feeType}{e.feeAmount ? ` · ₹${Number(e.feeAmount).toLocaleString("en-IN")}` : ""}</span><Badge className="bg-ct-cloud text-ct-muted">{e.status}</Badge></div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-xl shadow-card bg-white">
                <CardContent className="p-4">
                  <h3 className="font-heading text-lg text-ct-navy mb-3">Staff Assignments</h3>
                  <div className="flex gap-2 mb-3">
                    <Select onValueChange={async (userId) => {
                      const res = await fetch(`/api/the-firm/clients/${selectedClientId}/staff-assignments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, startDate: new Date().toISOString().slice(0, 10), role: "staff" }) });
                      if (!res.ok) { toast.error("Failed to assign staff"); return; }
                      toast.success("Staff assigned"); loadClientData(selectedClientId);
                    }}>
                      <SelectTrigger className="w-64"><SelectValue placeholder="Assign staff member…" /></SelectTrigger>
                      <SelectContent>{staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {staffAssignments.length === 0 ? <p className="text-sm text-ct-muted">No one assigned yet.</p> : (
                    <div className="flex flex-wrap gap-1.5">
                      {staffAssignments.map(a => <Badge key={a.id} className="bg-ct-cloud text-ct-navy">{staff.find(s => s.id === a.userId)?.name ?? a.userId} — {a.role}</Badge>)}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="taxcases" className="space-y-4">
          <div className="w-72"><Label>Client</Label>
            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
              <SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger>
              <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {selectedClientId && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-heading text-lg text-ct-navy">Tax Cases</h3>
                  <Dialog open={taxCaseOpen} onOpenChange={setTaxCaseOpen}>
                    <DialogTrigger asChild><Button size="sm" className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-3.5 h-3.5 mr-1" />New Tax Case</Button></DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>New Tax Case</DialogTitle></DialogHeader>
                      <div className="space-y-3">
                        <div><Label>Assessment Year</Label><Input value={tcYear} onChange={e => setTcYear(e.target.value)} placeholder="2025-26" /></div>
                        <div><Label>Case Type</Label>
                          <Select value={tcType} onValueChange={setTcType}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="scrutiny">Scrutiny</SelectItem><SelectItem value="reassessment">Reassessment</SelectItem><SelectItem value="appeal">Appeal</SelectItem><SelectItem value="gst_notice">GST Notice</SelectItem><SelectItem value="tds_default">TDS Default</SelectItem><SelectItem value="refund_claim">Refund Claim</SelectItem></SelectContent>
                          </Select>
                        </div>
                        <div><Label>Forum</Label>
                          <Select value={tcForum} onValueChange={setTcForum}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="ao">AO</SelectItem><SelectItem value="cit_a">CIT(A)</SelectItem><SelectItem value="itat">ITAT</SelectItem><SelectItem value="hc">High Court</SelectItem><SelectItem value="sc">Supreme Court</SelectItem></SelectContent>
                          </Select>
                        </div>
                      </div>
                      <DialogFooter><Button onClick={createTaxCase} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Create</Button></DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
                {taxCases.length === 0 ? <p className="text-sm text-ct-muted">No tax cases yet.</p> : (
                  <div className="space-y-1.5">
                    {taxCases.map(tc => (
                      <div key={tc.id} className="flex items-center justify-between text-sm border-b border-ct-border pb-1.5">
                        <div><span className="text-ct-navy font-medium">{tc.caseType} (AY {tc.assessmentYear})</span><span className="text-ct-muted text-xs ml-2">{tc.forum.toUpperCase()}</span></div>
                        <div className="flex items-center gap-2">
                          {tc.limitationDate && <span className="text-red-600 text-xs">Limitation: {tc.limitationDate}</span>}
                          <Select value={tc.stage} onValueChange={(v) => advanceTaxCaseStage(tc.id, v)}>
                            <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="notice_received">Notice Received</SelectItem><SelectItem value="hearing">Hearing</SelectItem><SelectItem value="order_passed">Order Passed</SelectItem><SelectItem value="appeal_filed">Appeal Filed</SelectItem><SelectItem value="closed">Closed</SelectItem></SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="billing" className="space-y-4">
          <div className="w-72"><Label>Client</Label>
            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
              <SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger>
              <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {selectedClientId && (
            <>
              <Card className="rounded-xl shadow-card bg-white">
                <CardContent className="p-4 space-y-3">
                  <h3 className="font-heading text-lg text-ct-navy">Time Tracking</h3>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1"><Label>Task</Label><Input value={teDescription} onChange={e => setTeDescription(e.target.value)} placeholder="What are you working on?" disabled={!!runningEntry} /></div>
                    {runningEntry ? (
                      <Button onClick={() => stopTimer(runningEntry.id)} variant="outline"><Square className="w-3.5 h-3.5 mr-1" />Stop</Button>
                    ) : (
                      <Button onClick={startTimer} className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Play className="w-3.5 h-3.5 mr-1" />Start</Button>
                    )}
                    <Dialog open={manualEntryOpen} onOpenChange={setManualEntryOpen}>
                      <DialogTrigger asChild><Button variant="outline">Log manually</Button></DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Log Time Manually</DialogTitle></DialogHeader>
                        <div className="space-y-3">
                          <div><Label>Task</Label><Input value={teDescription} onChange={e => setTeDescription(e.target.value)} /></div>
                          <div className="flex gap-3">
                            <div className="flex-1"><Label>Hours</Label><Input type="number" step="0.25" value={teHours} onChange={e => setTeHours(e.target.value)} /></div>
                            <div className="flex-1"><Label>Date</Label><Input type="date" value={teDate} onChange={e => setTeDate(e.target.value)} /></div>
                          </div>
                        </div>
                        <DialogFooter><Button onClick={logManualEntry} className="bg-ct-teal hover:bg-ct-teal-hover text-white">Log</Button></DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                  {timeEntries.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-ct-border">
                      {timeEntries.map(t => (
                        <div key={t.id} className="flex items-center justify-between text-sm">
                          <span className="text-ct-navy">{t.taskDescription}</span>
                          <div className="flex items-center gap-2 text-xs text-ct-muted">
                            {t.isRunning ? <Badge className="bg-amber-100 text-amber-700">running</Badge> : <span>{Number(t.hours).toFixed(2)}h</span>}
                            <span>{t.spentOn}</span>
                            {t.invoiceLineItemId ? <Badge className="bg-green-100 text-green-700">billed</Badge> : <Badge className="bg-ct-cloud text-ct-muted">unbilled</Badge>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-xl shadow-card bg-white">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-heading text-lg text-ct-navy">Invoices</h3>
                    <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
                      <DialogTrigger asChild><Button size="sm" className="bg-ct-teal hover:bg-ct-teal-hover text-white"><IndianRupee className="w-3.5 h-3.5 mr-1" />Generate from Unbilled Time</Button></DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Generate Invoice</DialogTitle></DialogHeader>
                        <div className="space-y-3">
                          <div><Label>Invoice Number</Label><Input value={invNumber} onChange={e => setInvNumber(e.target.value)} placeholder="INV-2026-001" /></div>
                          <div className="flex gap-3">
                            <div className="flex-1"><Label>Issue Date</Label><Input type="date" value={invIssueDate} onChange={e => setInvIssueDate(e.target.value)} /></div>
                            <div className="flex-1"><Label>Through Date</Label><Input type="date" value={invThroughDate} onChange={e => setInvThroughDate(e.target.value)} /></div>
                          </div>
                          <div><Label>Tax Rate (%)</Label><Input type="number" value={invTaxRate} onChange={e => setInvTaxRate(e.target.value)} /></div>
                        </div>
                        <DialogFooter><Button onClick={generateInvoice} disabled={generating} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{generating && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Generate</Button></DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                  {invoices.length === 0 ? <p className="text-sm text-ct-muted">No invoices yet.</p> : (
                    <div className="space-y-1.5">
                      {invoices.map(inv => (
                        <div key={inv.id} className="flex items-center justify-between text-sm border-b border-ct-border pb-1.5">
                          <div><span className="text-ct-navy font-medium">{inv.invoiceNumber}</span><span className="text-ct-muted text-xs ml-2">{inv.issueDate}</span></div>
                          <div className="flex items-center gap-2">
                            <span className="text-ct-navy">₹{Number(inv.totalAmount).toLocaleString("en-IN")}</span>
                            <Badge className={INVOICE_STATUS_COLORS[inv.status] ?? ""}>{inv.status}</Badge>
                            {inv.status === "draft" && <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => transitionInvoice(inv.id, "send")}>Send</Button>}
                            {inv.status === "sent" && <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => transitionInvoice(inv.id, "paid")}><CheckCircle2 className="w-3 h-3 mr-1" />Paid</Button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
