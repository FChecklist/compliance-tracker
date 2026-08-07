"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 41 (VERIDIAN CRM, PLATFORM_STRATEGY.md §20): a lead-to-client
// pipeline completing the existing Wave-1 Clients feature, not a generic
// sales CRM.
import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import Link from "next/link";
import {
  Loader2, UserPlus, Target, ArrowRightCircle, Sparkles, ListChecks, Building2,
  Search, Download, Upload, HelpCircle, Users,
} from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// VERIDIAN Review Framework gap-closure (2026-08-07), "Documentation &
// In-App Help Coverage": KB pages are org-scoped (no platform-wide row to
// safely seed cross-org), so a static inline panel is the reliable
// artifact here -- it also deep-links out to the real Knowledge Base
// module for anything beyond this quick-reference.
function LeadLifecycleHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Lead lifecycle help">
          <HelpCircle className="size-4 text-ct-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm space-y-2" align="end">
        <p className="font-semibold text-ct-navy">The lead lifecycle</p>
        <ol className="list-decimal list-inside space-y-1 text-ct-muted">
          <li><b>New</b> -- just captured, not yet worked.</li>
          <li><b>Contacted</b> -- a rep has reached out.</li>
          <li><b>Qualified</b> -- a real opportunity is likely; create an Opportunity from here.</li>
          <li><b>Converted</b> -- became a client (via Convert), or <b>Lost</b> -- didn't pan out.</li>
        </ol>
        <p className="text-ct-muted">Status changes only follow this order -- you can't skip back from Qualified to New. Use the AI sparkle to score a lead and get a recommended next action.</p>
        <Link href="/knowledge-base" className="text-ct-saffron hover:underline block pt-1">Open Knowledge Base &rarr;</Link>
      </PopoverContent>
    </Popover>
  );
}

type Lead = {
  id: string; name: string; contactEmail: string | null; source: string | null; status: string; convertedClientId: string | null;
  // VERIDIAN Review Framework Wave B (2026-07-17): nullable link to the new
  // crm_accounts table -- independent of convertedClientId (a lead can be
  // converted to a client, an account, both, or neither).
  accountId: string | null;
  aiScore: number | null; aiRecommendedAction: string | null;
};
type Opportunity = {
  id: string; name: string; leadId: string | null; clientId: string | null; stage: string; estimatedValue: string | null; expectedCloseDate: string | null;
  aiWinProbability: number | null; aiRiskFactors: string[]; aiRecommendedAction: string | null;
};

const LEAD_STATUS_COLORS: Record<string, string> = {
  new: "bg-ct-cloud text-ct-muted",
  contacted: "bg-ct-saffron/20 text-ct-saffron",
  qualified: "bg-ct-teal/20 text-ct-teal",
  converted: "bg-green-100 text-green-700",
  lost: "bg-red-100 text-red-700",
};

const OPP_STAGE_COLORS: Record<string, string> = {
  prospecting: "bg-ct-cloud text-ct-muted",
  proposal: "bg-ct-saffron/20 text-ct-saffron",
  negotiation: "bg-ct-teal/20 text-ct-teal",
  won: "bg-green-100 text-green-700",
  lost: "bg-red-100 text-red-700",
};

export default function CrmPage() {
  const currencies = useCurrencies();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);

  const [leadOpen, setLeadOpen] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [creatingLead, setCreatingLead] = useState(false);
  // VERIDIAN Review Framework gap-closure, "Error Handling & Data
  // Validation Messaging": per-field messages from ServiceError.fields,
  // rendered under the offending input instead of a single toast.
  const [leadFieldErrors, setLeadFieldErrors] = useState<Record<string, string>>({});

  // VERIDIAN Review Framework gap-closure, "Search, Filter & Bulk
  // Operations": search/status filter bar + bulk-select over leads.
  const [leadSearch, setLeadSearch] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState<string>("all");
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkReassignOwnerId, setBulkReassignOwnerId] = useState("");
  const [bulkReassigning, setBulkReassigning] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const [oppOpen, setOppOpen] = useState(false);
  const [oppName, setOppName] = useState("");
  const [oppLeadId, setOppLeadId] = useState("");
  const [oppValue, setOppValue] = useState("");
  const [creatingOpp, setCreatingOpp] = useState(false);
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [creatingTaskId, setCreatingTaskId] = useState<string | null>(null);

  const leadQueryParams = useCallback(() => {
    const params = new URLSearchParams();
    if (leadSearch.trim()) params.set("search", leadSearch.trim());
    if (leadStatusFilter !== "all") params.set("status", leadStatusFilter);
    return params;
  }, [leadSearch, leadStatusFilter]);

  const load = useCallback(async () => {
    const leadParams = leadQueryParams();
    const leadUrl = leadParams.toString() ? `/api/crm/leads?${leadParams.toString()}` : "/api/crm/leads";
    const [leadRes, oppRes] = await Promise.all([fetch(leadUrl), fetch("/api/crm/opportunities")]);
    const [leadData, oppData] = await Promise.all([leadRes.json(), oppRes.json()]);
    setLeads(leadData.leads ?? []);
    setOpportunities(oppData.opportunities ?? []);
    setSelectedLeadIds(new Set());
    setLoading(false);
  }, [leadQueryParams]);

  useEffect(() => {
    load();
  }, [load]);

  const createLead = async () => {
    if (!leadName.trim()) return;
    setCreatingLead(true);
    setLeadFieldErrors({});
    try {
      const res = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: leadName, contactEmail: leadEmail || undefined, source: leadSource || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.fields) setLeadFieldErrors(body.fields);
        throw new Error(body.error ?? "Failed to create lead");
      }
      toast.success("Lead created");
      setLeadOpen(false);
      setLeadName(""); setLeadEmail(""); setLeadSource(""); setLeadFieldErrors({});
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create lead");
    } finally {
      setCreatingLead(false);
    }
  };

  const toggleLeadSelected = (leadId: string) => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId); else next.add(leadId);
      return next;
    });
  };

  const toggleSelectAllLeads = () => {
    setSelectedLeadIds((prev) => (prev.size === leads.length ? new Set() : new Set(leads.map((l) => l.id))));
  };

  const bulkReassignLeads = async () => {
    if (selectedLeadIds.size === 0) return;
    setBulkReassigning(true);
    try {
      const res = await fetch("/api/crm/leads/bulk-reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: [...selectedLeadIds], ownerId: bulkReassignOwnerId || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success(`Reassigned ${selectedLeadIds.size} lead(s)`);
      setBulkReassignOwnerId("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to bulk-reassign leads");
    } finally {
      setBulkReassigning(false);
    }
  };

  const exportLeadsCsv = () => {
    const params = leadQueryParams();
    const url = params.toString() ? `/api/crm/leads/export?${params.toString()}` : "/api/crm/leads/export";
    window.open(url, "_blank");
  };

  const importLeadsCsv = async (file: File) => {
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/crm/leads/import", { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      const result = await res.json();
      if (result.errors?.length) {
        toast.info(`Imported ${result.success} lead(s), ${result.errors.length} row(s) failed`);
      } else {
        toast.success(`Imported ${result.success} lead(s)`);
      }
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import leads");
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  };

  const updateLeadStatus = async (leadId: string, status: string) => {
    try {
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      // VERIDIAN Review Framework gap-closure, "Business Rule & Validation
      // Accuracy": an invalid status transition now comes back as a real
      // 400 with a specific message (server-side VALID_LEAD_TRANSITIONS
      // check) instead of silently no-op'ing -- surface it instead of the
      // old generic "Failed to update lead".
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to update lead");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update lead");
    }
  };

  const convertLead = async (leadId: string) => {
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/convert`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Converted to client");
      load();
    } catch {
      toast.error("Failed to convert lead");
    }
  };

  // VERIDIAN Review Framework Wave B (2026-07-17): a lead that represents a
  // real company worth account-managing (not just a one-off client record)
  // converts into the new crm_accounts table instead -- independent of
  // convertLead() above.
  const convertLeadAccount = async (leadId: string) => {
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/convert-to-account`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Converted to account");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to convert lead to account");
    }
  };

  const createOpportunity = async () => {
    if (!oppName.trim() || !oppLeadId) return;
    setCreatingOpp(true);
    try {
      const res = await fetch("/api/crm/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: oppName, leadId: oppLeadId, estimatedValue: oppValue ? Number(oppValue) : undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Opportunity created");
      setOppOpen(false);
      setOppName(""); setOppLeadId(""); setOppValue("");
      load();
    } catch {
      toast.error("Failed to create opportunity");
    } finally {
      setCreatingOpp(false);
    }
  };

  const scoreLead = async (leadId: string) => {
    setScoringId(leadId);
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/score`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Lead scored");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to score lead");
    } finally {
      setScoringId(null);
    }
  };

  const analyzeOpportunity = async (opportunityId: string) => {
    setScoringId(opportunityId);
    try {
      const res = await fetch(`/api/crm/opportunities/${opportunityId}/analyze`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Opportunity analyzed");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to analyze opportunity");
    } finally {
      setScoringId(null);
    }
  };

  // Wave 78 (Multi-Agent Chaining): turns a lead/opportunity's AI-recommended
  // action into a real task, which itself runs through task-execution-
  // engine's own AI planning pass -- one module's AI output becoming another
  // module's AI input, per AI_OS_CERTIFICATION.md §2.2.
  const createFollowUpTask = async (kind: "leads" | "opportunities", id: string) => {
    setCreatingTaskId(id);
    try {
      const res = await fetch(`/api/crm/${kind}/${id}/follow-up-task`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Follow-up task created and dispatched to VERI To Do");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create follow-up task");
    } finally {
      setCreatingTaskId(null);
    }
  };

  const updateOpportunityStage = async (opportunityId: string, stage: string) => {
    try {
      const res = await fetch(`/api/crm/opportunities/${opportunityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Failed to update opportunity");
    }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-1">
          <div>
            <h1 className="text-2xl font-heading text-ct-navy">CRM</h1>
            <p className="text-sm text-ct-muted mt-1">Lead-to-client pipeline -- how you actually get a new client, not just manage an existing one.</p>
          </div>
          <LeadLifecycleHelp />
        </div>
        <Link href="/crm/accounts">
          <Button variant="outline"><Building2 className="size-4 mr-1.5" /> Accounts</Button>
        </Link>
      </div>

      <Tabs defaultValue="leads">
        <TabsList>
          <TabsTrigger value="leads"><UserPlus className="size-3.5 mr-1.5" /> Leads</TabsTrigger>
          <TabsTrigger value="opportunities"><Target className="size-3.5 mr-1.5" /> Opportunities</TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[240px]">
              <div className="relative flex-1 max-w-xs">
                <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ct-muted" />
                <Input
                  value={leadSearch}
                  onChange={(e) => setLeadSearch(e.target.value)}
                  placeholder="Search leads by name..."
                  className="pl-8 h-9"
                />
              </div>
              <Select value={leadStatusFilter} onValueChange={setLeadStatusFilter}>
                <SelectTrigger className="w-[140px] h-9 text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                  <SelectItem value="qualified">Qualified</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportLeadsCsv}>
                <Download className="size-3.5 mr-1.5" /> Export CSV
              </Button>
              <Link href="/api/crm/leads/import/template" className="text-xs text-ct-muted hover:underline self-center hidden sm:inline">Template</Link>
              <input
                ref={importFileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) importLeadsCsv(file); }}
              />
              <Button variant="outline" size="sm" onClick={() => importFileRef.current?.click()} disabled={importing}>
                {importing ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Upload className="size-3.5 mr-1.5" />}
                Import CSV
              </Button>
              <Dialog open={leadOpen} onOpenChange={setLeadOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" size="sm">New Lead</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Lead</DialogTitle><DialogDescription>A prospect not yet a client.</DialogDescription></DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                      <Input value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Acme Retail Pvt Ltd" />
                      {leadFieldErrors.name && <p className="text-xs text-red-600">{leadFieldErrors.name}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-ct-muted uppercase">Contact Email (optional)</Label>
                      <Input value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} placeholder="founder@acme.com" />
                      {leadFieldErrors.contactEmail && <p className="text-xs text-red-600">{leadFieldErrors.contactEmail}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-ct-muted uppercase">Source (optional)</Label>
                      <Input value={leadSource} onChange={(e) => setLeadSource(e.target.value)} placeholder="Referral" />
                      {leadFieldErrors.source && <p className="text-xs text-red-600">{leadFieldErrors.source}</p>}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={createLead} disabled={creatingLead || !leadName.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                      {creatingLead ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                      Create Lead
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {selectedLeadIds.size > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-ct-saffron/40 bg-ct-saffron/5 px-3 py-2 text-sm">
              <Users className="size-3.5 text-ct-saffron" />
              <span className="text-ct-navy">{selectedLeadIds.size} selected</span>
              <Input
                value={bulkReassignOwnerId}
                onChange={(e) => setBulkReassignOwnerId(e.target.value)}
                placeholder="Owner user ID to reassign to..."
                className="h-8 max-w-xs text-xs"
              />
              <Button size="sm" variant="outline" onClick={bulkReassignLeads} disabled={bulkReassigning}>
                {bulkReassigning ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
                Reassign
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedLeadIds(new Set())}>Clear</Button>
            </div>
          )}

          {leads.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No leads match these filters.</CardContent></Card>
          ) : (
            <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
              <div className="px-4 py-2 flex items-center gap-3 bg-ct-cloud/40">
                <Checkbox checked={selectedLeadIds.size === leads.length} onCheckedChange={toggleSelectAllLeads} aria-label="Select all leads" />
                <span className="text-xs text-ct-muted uppercase font-semibold">Select all</span>
              </div>
              {leads.map((lead) => (
                <div key={lead.id} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center gap-3">
                    <Checkbox checked={selectedLeadIds.has(lead.id)} onCheckedChange={() => toggleLeadSelected(lead.id)} aria-label={`Select ${lead.name}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ct-navy">{lead.name}</p>
                      <p className="text-xs text-ct-muted">{lead.contactEmail || "No contact"} {lead.source ? `· ${lead.source}` : ""}</p>
                    </div>
                    {lead.aiScore != null && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Sparkles className="size-3 text-ct-saffron" /> {lead.aiScore}
                      </Badge>
                    )}
                    <Badge className={`text-xs border-0 ${LEAD_STATUS_COLORS[lead.status] ?? "bg-ct-cloud text-ct-muted"}`}>{lead.status}</Badge>
                    {!lead.convertedClientId && lead.status !== "lost" && lead.status !== "converted" && (
                      <>
                        <Select value={lead.status} onValueChange={(v) => updateLeadStatus(lead.id, v)}>
                          <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="new">New</SelectItem>
                            <SelectItem value="contacted">Contacted</SelectItem>
                            <SelectItem value="qualified">Qualified</SelectItem>
                            <SelectItem value="lost">Lost</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="outline" onClick={() => convertLead(lead.id)}>
                          <ArrowRightCircle className="size-3.5 mr-1" /> Convert
                        </Button>
                      </>
                    )}
                    {!lead.accountId && (
                      <Button size="sm" variant="outline" onClick={() => convertLeadAccount(lead.id)}>
                        <Building2 className="size-3.5 mr-1" /> To Account
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => scoreLead(lead.id)} disabled={scoringId === lead.id}>
                      {scoringId === lead.id ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                    </Button>
                  </div>
                  {lead.aiRecommendedAction && (
                    <p className="text-xs text-ct-muted pl-0 flex items-center gap-2">
                      <span>AI suggests: {lead.aiRecommendedAction}</span>
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => createFollowUpTask("leads", lead.id)} disabled={creatingTaskId === lead.id}>
                        {creatingTaskId === lead.id ? <Loader2 className="size-3 animate-spin mr-1" /> : <ListChecks className="size-3 mr-1" />}
                        Create Task
                      </Button>
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="opportunities" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Dialog open={oppOpen} onOpenChange={setOppOpen}>
              <DialogTrigger asChild>
                <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={leads.length === 0}>New Opportunity</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Opportunity</DialogTitle><DialogDescription>Linked to a lead.</DialogDescription></DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                    <Input value={oppName} onChange={(e) => setOppName(e.target.value)} placeholder="GST advisory engagement" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Lead</Label>
                    <Select value={oppLeadId} onValueChange={setOppLeadId}>
                      <SelectTrigger><SelectValue placeholder="Choose a lead" /></SelectTrigger>
                      <SelectContent>
                        {leads.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Estimated Value (optional)</Label>
                    <Input type="number" value={oppValue} onChange={(e) => setOppValue(e.target.value)} placeholder="150000" />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={createOpportunity} disabled={creatingOpp || !oppName.trim() || !oppLeadId} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                    {creatingOpp ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                    Create Opportunity
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {opportunities.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No opportunities yet.</CardContent></Card>
          ) : (
            <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
              {opportunities.map((opp) => (
                <div key={opp.id} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ct-navy">{opp.name}</p>
                      <p className="text-xs text-ct-muted">
                        {opp.estimatedValue ? `${currencyLabel(undefined, currencies)}${Number(opp.estimatedValue).toLocaleString()}` : "No value set"}
                        {opp.expectedCloseDate ? ` · closes ${new Date(opp.expectedCloseDate).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                    {opp.aiWinProbability != null && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Sparkles className="size-3 text-ct-saffron" /> {opp.aiWinProbability}% win
                      </Badge>
                    )}
                    <Badge className={`text-xs border-0 ${OPP_STAGE_COLORS[opp.stage] ?? "bg-ct-cloud text-ct-muted"}`}>{opp.stage}</Badge>
                    <Select value={opp.stage} onValueChange={(v) => updateOpportunityStage(opp.id, v)}>
                      <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="prospecting">Prospecting</SelectItem>
                        <SelectItem value="proposal">Proposal</SelectItem>
                        <SelectItem value="negotiation">Negotiation</SelectItem>
                        <SelectItem value="won">Won</SelectItem>
                        <SelectItem value="lost">Lost</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="ghost" onClick={() => analyzeOpportunity(opp.id)} disabled={scoringId === opp.id}>
                      {scoringId === opp.id ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                    </Button>
                  </div>
                  {(opp.aiRecommendedAction || opp.aiRiskFactors?.length > 0) && (
                    <p className="text-xs text-ct-muted flex items-center gap-2 flex-wrap">
                      <span>
                        {opp.aiRiskFactors?.length > 0 && <>Risks: {opp.aiRiskFactors.join(", ")}. </>}
                        {opp.aiRecommendedAction && <>AI suggests: {opp.aiRecommendedAction}</>}
                      </span>
                      {opp.aiRecommendedAction && (
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => createFollowUpTask("opportunities", opp.id)} disabled={creatingTaskId === opp.id}>
                          {creatingTaskId === opp.id ? <Loader2 className="size-3 animate-spin mr-1" /> : <ListChecks className="size-3 mr-1" />}
                          Create Task
                        </Button>
                      )}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
