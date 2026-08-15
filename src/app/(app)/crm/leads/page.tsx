"use client";

export const dynamic = "force-dynamic";

// Wave 3 (2026-07-21): dedicated, paginated Leads page -- the crm/page.tsx
// hub had a full-featured Leads tab (score/convert/explain/follow-up task)
// but fetched via the unpaged listLeads() and had no detail page, no
// search, no filters beyond inline status. This carries every existing
// action forward unchanged (same endpoints, same behavior) and adds real
// search/filter/pagination (now wired in Wave 3's leads/route.ts fix) plus
// a link through to a real detail page, matching crm/accounts/page.tsx's
// already-established pattern for this module.
//
// VERIDIAN Review Framework gap-closure (2026-08-07): adds bulk-select +
// bulk-reassign, CSV export/import, per-field validation error rendering,
// and an in-app lead-lifecycle help panel -- ported here (rather than
// crm/page.tsx, which Wave 3 already turned into a plain overview/link
// dashboard) since this is the real, current Leads UI.
import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import Link from "next/link";
import {
  Loader2, UserPlus, Sparkles, ListChecks, ArrowRightCircle, Building2,
  ChevronLeft, ChevronRight, Search, Download, Upload, HelpCircle, Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ModuleNotEnabledCard } from "@/components/ModuleNotEnabledCard";

type Lead = {
  id: string; name: string; contactEmail: string | null; source: string | null; status: string;
  convertedClientId: string | null; accountId: string | null;
  aiScore: number | null; aiRecommendedAction: string | null;
};

const LEAD_STATUS_COLORS: Record<string, string> = {
  new: "bg-ct-cloud text-ct-muted",
  contacted: "bg-ct-saffron/20 text-ct-saffron",
  qualified: "bg-ct-teal/20 text-ct-teal",
  converted: "bg-green-100 text-green-700",
  lost: "bg-red-100 text-red-700",
};

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

export default function CrmLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [creatingTaskId, setCreatingTaskId] = useState<string | null>(null);
  const [salesEnabled, setSalesEnabled] = useState<boolean | null>(null);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("");
  const [creating, setCreating] = useState(false);
  // VERIDIAN Review Framework gap-closure, "Error Handling & Data
  // Validation Messaging": per-field messages from ServiceError.fields,
  // rendered under the offending input instead of a single toast.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // VERIDIAN Review Framework gap-closure, "Search, Filter & Bulk
  // Operations": bulk-select + bulk-reassign toolbar over the current page
  // of leads. "Data Import/Export Template Fidelity": CSV export/import.
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkReassignOwnerId, setBulkReassignOwnerId] = useState("");
  const [bulkReassigning, setBulkReassigning] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const queryParams = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) params.set("search", search.trim());
    if (statusFilter !== "all") params.set("status", statusFilter);
    return params;
  }, [page, search, statusFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/crm/leads?${queryParams().toString()}`);
    const data = await res.json();
    setLeads(data.items ?? []);
    setTotal(data.total ?? 0);
    setSelectedLeadIds(new Set());
    setLoading(false);
  }, [queryParams]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setSalesEnabled(d.salesEnabled ?? false)).catch(() => setSalesEnabled(false));
  }, []);

  const createLead = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setFieldErrors({});
    try {
      const res = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, contactEmail: email || undefined, source: source || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.fields) setFieldErrors(body.fields);
        throw new Error(body.error ?? "Failed to create lead");
      }
      toast.success("Lead created");
      setOpen(false);
      setName(""); setEmail(""); setSource(""); setFieldErrors({});
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create lead");
    } finally {
      setCreating(false);
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
    const params = queryParams();
    window.open(`/api/crm/leads/export?${params.toString()}`, "_blank");
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

  const updateStatus = async (leadId: string, status: string) => {
    try {
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch { toast.error("Failed to update lead"); }
  };

  const convertToClient = async (leadId: string) => {
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/convert`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Converted to client");
      load();
    } catch { toast.error("Failed to convert lead"); }
  };

  const convertToAccount = async (leadId: string) => {
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/convert-to-account`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Converted to account");
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to convert lead to account"); }
  };

  const scoreLead = async (leadId: string) => {
    setScoringId(leadId);
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/score`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Lead scored");
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to score lead"); }
    finally { setScoringId(null); }
  };

  const createFollowUpTask = async (leadId: string) => {
    setCreatingTaskId(leadId);
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/follow-up-task`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Follow-up task created and dispatched to VERI To Do");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to create follow-up task"); }
    finally { setCreatingTaskId(null); }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (salesEnabled === false) {
    return <ModuleNotEnabledCard moduleName="CRM" settingsSection="Sales & CRM" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-1">
          <div>
            <h1 className="text-2xl font-heading text-ct-navy">Leads</h1>
            <p className="text-sm text-ct-muted mt-1">Prospects not yet a client -- score, qualify, and convert.</p>
          </div>
          <LeadLifecycleHelp />
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"><UserPlus className="w-4 h-4 mr-1" />New Lead</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Lead</DialogTitle><DialogDescription>A prospect not yet a client.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Retail Pvt Ltd" />
                {fieldErrors.name && <p className="text-xs text-red-600">{fieldErrors.name}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Contact Email (optional)</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="founder@acme.com" />
                {fieldErrors.contactEmail && <p className="text-xs text-red-600">{fieldErrors.contactEmail}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Source (optional)</Label>
                <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Referral" />
                {fieldErrors.source && <p className="text-xs text-red-600">{fieldErrors.source}</p>}
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createLead} disabled={creating || !name.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create Lead
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <div className="relative max-w-sm flex-1">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ct-muted" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search leads by name..."
              className="pl-8"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
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

      {loading ? <p className="text-sm text-ct-muted">Loading...</p> : leads.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No leads match these filters.</CardContent></Card>
      ) : (
        <>
          <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
            <div className="px-4 py-2 flex items-center gap-3 bg-ct-cloud/40">
              <Checkbox checked={selectedLeadIds.size === leads.length} onCheckedChange={toggleSelectAllLeads} aria-label="Select all leads" />
              <span className="text-xs text-ct-muted uppercase font-semibold">Select all</span>
            </div>
            {leads.map((lead) => (
              <div key={lead.id} className="px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-3">
                  <Checkbox checked={selectedLeadIds.has(lead.id)} onCheckedChange={() => toggleLeadSelected(lead.id)} aria-label={`Select ${lead.name}`} />
                  <Link href={`/crm/leads/${lead.id}`} className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ct-navy hover:underline">{lead.name}</p>
                    <p className="text-xs text-ct-muted">{lead.contactEmail || "No contact"} {lead.source ? `· ${lead.source}` : ""}</p>
                  </Link>
                  {lead.aiScore != null && (
                    <Badge variant="outline" className="text-xs gap-1"><Sparkles className="size-3 text-ct-saffron" /> {lead.aiScore}</Badge>
                  )}
                  <Badge className={`text-xs border-0 ${LEAD_STATUS_COLORS[lead.status] ?? "bg-ct-cloud text-ct-muted"}`}>{lead.status}</Badge>
                  {!lead.convertedClientId && lead.status !== "lost" && lead.status !== "converted" && (
                    <>
                      <Select value={lead.status} onValueChange={(v) => updateStatus(lead.id, v)}>
                        <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new">New</SelectItem>
                          <SelectItem value="contacted">Contacted</SelectItem>
                          <SelectItem value="qualified">Qualified</SelectItem>
                          <SelectItem value="lost">Lost</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" onClick={() => convertToClient(lead.id)}><ArrowRightCircle className="size-3.5 mr-1" /> Convert</Button>
                    </>
                  )}
                  {!lead.accountId && (
                    <Button size="sm" variant="outline" onClick={() => convertToAccount(lead.id)}><Building2 className="size-3.5 mr-1" /> To Account</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => scoreLead(lead.id)} disabled={scoringId === lead.id}>
                    {scoringId === lead.id ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  </Button>
                </div>
                {lead.aiRecommendedAction && (
                  <p className="text-xs text-ct-muted flex items-center gap-2">
                    <span>AI suggests: {lead.aiRecommendedAction}</span>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => createFollowUpTask(lead.id)} disabled={creatingTaskId === lead.id}>
                      {creatingTaskId === lead.id ? <Loader2 className="size-3 animate-spin mr-1" /> : <ListChecks className="size-3 mr-1" />}
                      Create Task
                    </Button>
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between text-xs text-ct-muted">
            <span>{total} lead{total === 1 ? "" : "s"} total</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 px-2" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="size-3.5" /></Button>
              <span>Page {page} of {totalPages}</span>
              <Button size="sm" variant="outline" className="h-7 px-2" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="size-3.5" /></Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
