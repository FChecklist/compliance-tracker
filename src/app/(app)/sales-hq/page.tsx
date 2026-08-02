"use client";

// Wave 109 (Sales Engine): owner-only internal view of every sales
// partner, referral, and commission-plan across the whole platform.
// veridian_admin-gated at the service layer (same authority bar as
// prompt-eval's own page) -- reachable by any signed-in user, but every
// write/read action here 403s for non-admins, so a non-admin sees empty
// error states rather than real data.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Users, Link2, Wallet, Plus, Loader2, RefreshCw, Ban } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { VisitorIntelligencePanel } from "@/components/VisitorIntelligencePanel";

const PARTNER_TYPES = ["reseller", "consultant", "referral_agent", "commission_agent", "third_party", "internal_employee", "call_centre_agent"];
const PRODUCT_KEYS = ["grc", "erp", "pms", "hr", "crm", "facilities_management", "the_firm", "forge"];

type Partner = { id: string; name: string; email: string; partnerType: string; status: string; companyName: string | null; createdAt: string };
type CommissionPlan = { id: string; productKey: string; partnerType: string | null; commissionType: string; rate: string | null; flatAmount: string | null; currency: string };
type Overview = {
  partners: Partner[];
  referralsByStatus: Record<string, number>;
  liabilityByProduct: Record<string, { accrued: number; paid: number }>;
  plans: CommissionPlan[];
};

export default function SalesHqPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newPartnerName, setNewPartnerName] = useState("");
  const [newPartnerEmail, setNewPartnerEmail] = useState("");
  const [newPartnerType, setNewPartnerType] = useState("reseller");
  const [creatingPartner, setCreatingPartner] = useState(false);

  const [newPlanProduct, setNewPlanProduct] = useState("grc");
  const [newPlanRate, setNewPlanRate] = useState("");
  const [creatingPlan, setCreatingPlan] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sales-hq/overview");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to load sales overview");
      } else {
        setOverview(await res.json());
        setError(null);
      }
    } catch {
      setError("Failed to load sales overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createPartner = async () => {
    if (!newPartnerName.trim() || !newPartnerEmail.trim()) return;
    setCreatingPartner(true);
    try {
      const res = await fetch("/api/sales-hq/partners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPartnerName, email: newPartnerEmail, partnerType: newPartnerType }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create partner");
      const partner = await res.json();
      toast.success(`Partner created -- dashboard token: ${partner.dashboardToken}`);
      setNewPartnerName(""); setNewPartnerEmail("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create partner");
    } finally {
      setCreatingPartner(false);
    }
  };

  const createPlan = async () => {
    if (!newPlanRate) return;
    setCreatingPlan(true);
    try {
      const res = await fetch("/api/sales-hq/commission-plans", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productKey: newPlanProduct, commissionType: "percentage", rate: Number(newPlanRate) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create plan");
      toast.success("Commission plan created");
      setNewPlanRate("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create plan");
    } finally {
      setCreatingPlan(false);
    }
  };

  const partnerAction = async (id: string, action: "revoke" | "rotate" | "suspend") => {
    try {
      const res = await fetch(`/api/sales-hq/partners/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Action failed");
      if (action === "rotate") {
        const updated = await res.json();
        toast.success(`New token: ${updated.dashboardToken}`);
      } else {
        toast.success("Done");
      }
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  };

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="size-6 animate-spin text-ct-teal" /></div>;
  if (error || !overview) return <div className="p-8"><p className="text-sm text-ct-muted">{error}</p></div>;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <VisitorIntelligencePanel />
      <div>
        <h1 className="text-2xl font-heading text-ct-navy flex items-center gap-2"><Users className="size-6" /> Sales HQ</h1>
        <p className="text-sm text-ct-muted">Every sales partner, referral, and commission plan across the platform.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-ct-muted uppercase font-semibold">Partners</p>
          <p className="text-2xl font-heading text-ct-navy mt-1">{overview.partners.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-ct-muted uppercase font-semibold">Referrals by status</p>
          <div className="mt-1 space-y-0.5">
            {Object.entries(overview.referralsByStatus).map(([s, c]) => (
              <div key={s} className="flex justify-between text-sm"><span className="text-ct-slate capitalize">{s.replace(/_/g, " ")}</span><span className="font-medium text-ct-navy">{c}</span></div>
            ))}
            {Object.keys(overview.referralsByStatus).length === 0 && <p className="text-xs text-ct-muted">No referrals yet</p>}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-ct-muted uppercase font-semibold flex items-center gap-1"><Wallet className="size-3.5" /> Commission liability</p>
          <div className="mt-1 space-y-0.5">
            {Object.entries(overview.liabilityByProduct).map(([p, v]) => (
              <div key={p} className="flex justify-between text-sm"><span className="text-ct-slate">{p}</span><span className="font-medium text-ct-navy">₹{v.accrued.toLocaleString("en-IN")} accrued</span></div>
            ))}
            {Object.keys(overview.liabilityByProduct).length === 0 && <p className="text-xs text-ct-muted">No commission activity yet</p>}
          </div>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ct-navy flex items-center gap-2"><Users className="size-4" /> Partners</h2>
            <Dialog>
              <DialogTrigger asChild><Button size="sm"><Plus className="size-4 mr-1" /> New Partner</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create Sales Partner</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Name</Label><Input value={newPartnerName} onChange={(e) => setNewPartnerName(e.target.value)} /></div>
                  <div><Label>Email</Label><Input type="email" value={newPartnerEmail} onChange={(e) => setNewPartnerEmail(e.target.value)} /></div>
                  <div>
                    <Label>Partner Type</Label>
                    <Select value={newPartnerType} onValueChange={setNewPartnerType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{PARTNER_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter><Button onClick={createPartner} disabled={creatingPartner}>{creatingPartner && <Loader2 className="size-4 animate-spin mr-1" />} Create</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {overview.partners.length === 0 ? <p className="text-xs text-ct-muted">No partners yet.</p> : (
            <div className="space-y-2">
              {overview.partners.map((p) => (
                <div key={p.id} className="flex items-center justify-between border border-ct-border rounded-lg p-3">
                  <div>
                    <p className="text-sm font-medium text-ct-navy">{p.name} <Badge variant="outline" className="ml-1 capitalize">{p.partnerType.replace(/_/g, " ")}</Badge></p>
                    <p className="text-xs text-ct-muted">{p.email} · {p.status}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => partnerAction(p.id, "rotate")}><RefreshCw className="size-3.5" /></Button>
                    <Button size="sm" variant="outline" onClick={() => partnerAction(p.id, "suspend")}><Ban className="size-3.5" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ct-navy flex items-center gap-2"><Link2 className="size-4" /> Commission Plans</h2>
            <Dialog>
              <DialogTrigger asChild><Button size="sm"><Plus className="size-4 mr-1" /> New Plan</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create Commission Plan</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Product</Label>
                    <Select value={newPlanProduct} onValueChange={setNewPlanProduct}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{PRODUCT_KEYS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Percentage Rate</Label><Input type="number" value={newPlanRate} onChange={(e) => setNewPlanRate(e.target.value)} placeholder="e.g. 10" /></div>
                </div>
                <DialogFooter><Button onClick={createPlan} disabled={creatingPlan}>{creatingPlan && <Loader2 className="size-4 animate-spin mr-1" />} Create</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {overview.plans.length === 0 ? <p className="text-xs text-ct-muted">No commission plans yet.</p> : (
            <div className="space-y-1.5">
              {overview.plans.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm border-b border-ct-border/60 last:border-0 py-1.5">
                  <span className="text-ct-navy font-medium">{p.productKey}</span>
                  <span className="text-ct-muted">{p.partnerType ? p.partnerType.replace(/_/g, " ") : "default"}</span>
                  <span className="text-ct-navy">{p.commissionType === "percentage" ? `${p.rate}%` : `${p.currency} ${p.flatAmount}`}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
