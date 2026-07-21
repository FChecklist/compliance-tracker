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
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Loader2, UserPlus, Sparkles, ListChecks, ArrowRightCircle, Building2, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

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

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) params.set("search", search.trim());
    if (statusFilter !== "all") params.set("status", statusFilter);
    const res = await fetch(`/api/crm/leads?${params.toString()}`);
    const data = await res.json();
    setLeads(data.items ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, [page, search, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const createLead = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, contactEmail: email || undefined, source: source || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Lead created");
      setOpen(false);
      setName(""); setEmail(""); setSource("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create lead");
    } finally {
      setCreating(false);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Leads</h1>
          <p className="text-sm text-ct-muted mt-1">Prospects not yet a client -- score, qualify, and convert.</p>
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
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Contact Email (optional)</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="founder@acme.com" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Source (optional)</Label>
                <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Referral" />
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

      <div className="flex items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search leads by name..." className="max-w-sm" />
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

      {loading ? <p className="text-sm text-ct-muted">Loading...</p> : leads.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No leads yet.</CardContent></Card>
      ) : (
        <>
          <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
            {leads.map((lead) => (
              <div key={lead.id} className="px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-3">
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
