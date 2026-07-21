"use client";

export const dynamic = "force-dynamic";

// Wave 3 (2026-07-21): first-ever Campaigns page (Wave 1's crm_campaigns
// table + Wave 2's routes had no UI at all yet). Zoho reference: Campaigns
// is a simple planned/active/completed/cancelled list with Create -- kept
// deliberately simple to match, not gold-plated with anything the
// reference systems don't have either.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Megaphone, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Campaign = { id: string; name: string; campaignType: string | null; status: string; startDate: string | null; endDate: string | null; expectedRevenue: string | null };

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-ct-cloud text-ct-muted", active: "bg-ct-teal/20 text-ct-teal",
  completed: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700",
};

export default function CrmCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [campaignType, setCampaignType] = useState("");
  const [status, setStatus] = useState<"planning" | "active" | "completed" | "cancelled">("planning");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/crm/campaigns");
    setCampaigns(res.ok ? await res.json() : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const createCampaign = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/crm/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, campaignType: campaignType || undefined, status }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Campaign created");
      setOpen(false);
      setName(""); setCampaignType(""); setStatus("planning");
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to create campaign"); }
    finally { setCreating(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Campaigns</h1>
          <p className="text-sm text-ct-muted mt-1">Marketing efforts leads can be attributed to.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"><Plus className="w-4 h-4 mr-1" />New Campaign</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Campaign</DialogTitle><DialogDescription>Plan a marketing effort you can attribute leads to.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 webinar series" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Type (optional)</Label>
                <Input value={campaignType} onChange={(e) => setCampaignType(e.target.value)} placeholder="Webinar" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planning">Planning</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createCampaign} disabled={creating || !name.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create Campaign
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? <p className="text-sm text-ct-muted">Loading...</p> : campaigns.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center space-y-2"><Megaphone className="size-10 text-ct-muted mx-auto" /><p className="text-sm text-ct-muted">No campaigns yet.</p></CardContent></Card>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
          {campaigns.map((c) => (
            <div key={c.id} className="px-4 py-3 flex items-center gap-3">
              <Megaphone className="size-4 text-ct-saffron shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ct-navy">{c.name}</p>
                <p className="text-xs text-ct-muted">
                  {c.campaignType ?? "No type set"}
                  {c.startDate ? ` · starts ${new Date(c.startDate).toLocaleDateString()}` : ""}
                </p>
              </div>
              <Badge className={`text-xs border-0 ${STATUS_COLORS[c.status] ?? "bg-ct-cloud text-ct-muted"}`}>{c.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
