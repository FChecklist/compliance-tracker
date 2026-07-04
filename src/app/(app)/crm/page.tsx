"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 41 (VERIDIAN CRM, PLATFORM_STRATEGY.md §20): a lead-to-client
// pipeline completing the existing Wave-1 Clients feature, not a generic
// sales CRM.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, UserPlus, Target, ArrowRightCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

type Lead = { id: string; name: string; contactEmail: string | null; source: string | null; status: string; convertedClientId: string | null };
type Opportunity = { id: string; name: string; leadId: string | null; clientId: string | null; stage: string; estimatedValue: string | null; expectedCloseDate: string | null };

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
  const [leads, setLeads] = useState<Lead[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);

  const [leadOpen, setLeadOpen] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [creatingLead, setCreatingLead] = useState(false);

  const [oppOpen, setOppOpen] = useState(false);
  const [oppName, setOppName] = useState("");
  const [oppLeadId, setOppLeadId] = useState("");
  const [oppValue, setOppValue] = useState("");
  const [creatingOpp, setCreatingOpp] = useState(false);

  const load = useCallback(async () => {
    const [leadRes, oppRes] = await Promise.all([fetch("/api/crm/leads"), fetch("/api/crm/opportunities")]);
    const [leadData, oppData] = await Promise.all([leadRes.json(), oppRes.json()]);
    setLeads(leadData.leads ?? []);
    setOpportunities(oppData.opportunities ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createLead = async () => {
    if (!leadName.trim()) return;
    setCreatingLead(true);
    try {
      const res = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: leadName, contactEmail: leadEmail || undefined, source: leadSource || undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Lead created");
      setLeadOpen(false);
      setLeadName(""); setLeadEmail(""); setLeadSource("");
      load();
    } catch {
      toast.error("Failed to create lead");
    } finally {
      setCreatingLead(false);
    }
  };

  const updateLeadStatus = async (leadId: string, status: string) => {
    try {
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Failed to update lead");
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
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">CRM</h1>
        <p className="text-sm text-ct-muted mt-1">Lead-to-client pipeline -- how you actually get a new client, not just manage an existing one.</p>
      </div>

      <Tabs defaultValue="leads">
        <TabsList>
          <TabsTrigger value="leads"><UserPlus className="size-3.5 mr-1.5" /> Leads</TabsTrigger>
          <TabsTrigger value="opportunities"><Target className="size-3.5 mr-1.5" /> Opportunities</TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Dialog open={leadOpen} onOpenChange={setLeadOpen}>
              <DialogTrigger asChild>
                <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">New Lead</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Lead</DialogTitle><DialogDescription>A prospect not yet a client.</DialogDescription></DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                    <Input value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Acme Retail Pvt Ltd" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Contact Email (optional)</Label>
                    <Input value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} placeholder="founder@acme.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Source (optional)</Label>
                    <Input value={leadSource} onChange={(e) => setLeadSource(e.target.value)} placeholder="Referral" />
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

          {leads.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No leads yet.</CardContent></Card>
          ) : (
            <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
              {leads.map((lead) => (
                <div key={lead.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ct-navy">{lead.name}</p>
                    <p className="text-xs text-ct-muted">{lead.contactEmail || "No contact"} {lead.source ? `· ${lead.source}` : ""}</p>
                  </div>
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
                <div key={opp.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ct-navy">{opp.name}</p>
                    <p className="text-xs text-ct-muted">
                      {opp.estimatedValue ? `₹${Number(opp.estimatedValue).toLocaleString()}` : "No value set"}
                      {opp.expectedCloseDate ? ` · closes ${new Date(opp.expectedCloseDate).toLocaleDateString()}` : ""}
                    </p>
                  </div>
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
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
