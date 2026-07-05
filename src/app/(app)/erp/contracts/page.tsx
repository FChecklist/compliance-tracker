"use client";

export const dynamic = "force-dynamic";

// Wave 71 (Contract & Commercial Lifecycle Management) -- per
// COMPARISON_CSV_GAP_ANALYSIS.md, Sales>Contract Management was a complete
// gap (the existing contract_compliance_items table is an unrelated GRC
// obligations register). Contracts tab (SLA/renewals/amendments/billing/
// revenue/obligations) + Subscriptions tab (plans + lifecycle).
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { FileSignature, Plus, Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RequestSignatureButton } from "@/components/esignature/RequestSignatureButton";

type Customer = { id: string; customerName: string };
type Contract = { id: string; contractNumber: number; title: string; customerId: string; status: string; startDate: string; endDate: string | null; contractValue: string; autoRenew: boolean };
type Amendment = { id: string; amendmentNumber: number; description: string; status: string; effectiveDate: string };
type Obligation = { id: string; description: string; dueDate: string; status: string };
type BillingSchedule = { id: string; billingFrequency: string; nextBillingDate: string; amount: string };
type ContractDetail = Contract & { amendments: Amendment[]; obligations: Obligation[]; billingSchedules: BillingSchedule[] };
type SubscriptionPlan = { id: string; name: string; billingFrequency: string; price: string };
type Subscription = { id: string; customerId: string; planId: string; status: string; startDate: string; nextRenewalDate: string | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  draft: "outline", active: "default", expired: "secondary", terminated: "secondary", renewed: "default",
};

function fmt(n: string | number) { return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function ErpContractsPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContractDetail | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [contractValue, setContractValue] = useState("");
  const [creating, setCreating] = useState(false);

  const [obligationDesc, setObligationDesc] = useState("");
  const [obligationDue, setObligationDue] = useState("");

  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [planName, setPlanName] = useState("");
  const [planPrice, setPlanPrice] = useState("");
  const [planFrequency, setPlanFrequency] = useState("monthly");
  const [creatingPlan, setCreatingPlan] = useState(false);

  const load = useCallback(async () => {
    const [custRes, contractRes, planRes, subRes] = await Promise.all([
      fetch("/api/erp/selling/customers").catch(() => null),
      fetch("/api/erp/contracts"),
      fetch("/api/erp/subscription-plans"),
      fetch("/api/erp/subscriptions"),
    ]);
    setCustomers(custRes ? (await custRes.json()).customers ?? [] : []);
    setContracts((await contractRes.json()).contracts ?? []);
    setPlans((await planRes.json()).plans ?? []);
    setSubscriptions((await subRes.json()).subscriptions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadDetail(id: string) {
    setSelectedId(id);
    const res = await fetch(`/api/erp/contracts/${id}`);
    setDetail(res.ok ? await res.json() : null);
  }

  async function createContract() {
    if (!title.trim() || !customerId || !startDate) { toast.error("Title, customer and start date are required"); return; }
    setCreating(true);
    const res = await fetch("/api/erp/contracts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, customerId, startDate, endDate: endDate || undefined, contractValue: contractValue ? Number(contractValue) : undefined }),
    });
    setCreating(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to create contract"); return; }
    toast.success("Contract created");
    setDialogOpen(false);
    setTitle(""); setCustomerId(""); setEndDate(""); setContractValue("");
    load();
  }

  async function transitionContract(id: string, status: string) {
    const res = await fetch(`/api/erp/contracts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to update contract"); return; }
    toast.success(`Contract marked ${status}`);
    load();
    if (selectedId === id) loadDetail(id);
  }

  async function addObligation() {
    if (!selectedId || !obligationDesc.trim() || !obligationDue) { toast.error("Description and due date are required"); return; }
    const res = await fetch(`/api/erp/contracts/${selectedId}/obligations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: obligationDesc, dueDate: obligationDue }) });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to add obligation"); return; }
    setObligationDesc(""); setObligationDue("");
    loadDetail(selectedId);
  }

  async function completeObligation(id: string) {
    const res = await fetch(`/api/erp/contracts/obligations/${id}/complete`, { method: "POST" });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to complete obligation"); return; }
    if (selectedId) loadDetail(selectedId);
  }

  async function createPlan() {
    if (!planName.trim() || !planPrice) { toast.error("Name and price are required"); return; }
    setCreatingPlan(true);
    const res = await fetch("/api/erp/subscription-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: planName, price: Number(planPrice), billingFrequency: planFrequency }) });
    setCreatingPlan(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to create plan"); return; }
    toast.success("Subscription plan created");
    setPlanDialogOpen(false);
    setPlanName(""); setPlanPrice("");
    load();
  }

  const customerNameById = new Map(customers.map((c) => [c.id, c.customerName]));
  const planNameById = new Map(plans.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2"><FileSignature className="w-6 h-6" />Contracts</h1>
        <p className="text-sm text-ct-muted mt-1">Commercial contract lifecycle — SLA, renewals, amendments, recurring billing, revenue recognition, obligations, subscriptions</p>
      </div>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <Tabs defaultValue="contracts">
          <TabsList>
            <TabsTrigger value="contracts">Contracts</TabsTrigger>
            <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
          </TabsList>

          <TabsContent value="contracts">
            <div className="flex justify-end mb-2">
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal/90"><Plus className="w-4 h-4 mr-1" />New Contract</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Contract</DialogTitle><DialogDescription>Draft contract — activate once terms are finalized.</DialogDescription></DialogHeader>
                  <div className="space-y-3">
                    <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Annual Support Agreement" /></div>
                    <div>
                      <Label>Customer</Label>
                      <Select value={customerId} onValueChange={setCustomerId}>
                        <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                        <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Start Date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
                      <div><Label>End Date</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
                    </div>
                    <div><Label>Contract Value</Label><Input type="number" value={contractValue} onChange={(e) => setContractValue(e.target.value)} placeholder="0.00" /></div>
                  </div>
                  <DialogFooter><Button onClick={createContract} disabled={creating}>{creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Contract"}</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <Card className="rounded-xl shadow-card bg-white">
                <CardContent className="p-0">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">#</th><th className="p-3 font-medium">Title</th><th className="p-3 font-medium">Customer</th><th className="p-3 font-medium">Value</th><th className="p-3 font-medium">Status</th></tr></thead>
                    <tbody className="divide-y divide-ct-border">
                      {contracts.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-ct-muted">No contracts yet.</td></tr>
                        : contracts.map((c) => (
                          <tr key={c.id} className={`hover:bg-ct-row-hover cursor-pointer ${selectedId === c.id ? "bg-ct-row-hover" : ""}`} onClick={() => loadDetail(c.id)}>
                            <td className="p-3">{c.contractNumber}</td>
                            <td className="p-3">{c.title}</td>
                            <td className="p-3">{customerNameById.get(c.customerId) ?? "—"}</td>
                            <td className="p-3">{fmt(c.contractValue)}</td>
                            <td className="p-3"><Badge variant={STATUS_VARIANT[c.status] ?? "outline"}>{c.status}</Badge></td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <Card className="rounded-xl shadow-card bg-white">
                <CardContent className="p-4">
                  {!selectedId || !detail ? (
                    <p className="text-sm text-ct-muted">Select a contract to view details.</p>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium text-ct-navy">{detail.title}</h3>
                        <div className="flex gap-2 items-center">
                          {detail.status === "draft" && <Button size="sm" onClick={() => transitionContract(detail.id, "active")}>Activate</Button>}
                          {detail.status === "active" && <Button size="sm" variant="outline" onClick={() => transitionContract(detail.id, "renewed")}>Renew</Button>}
                          {(detail.status === "draft" || detail.status === "active" || detail.status === "renewed") && <Button size="sm" variant="outline" onClick={() => transitionContract(detail.id, "terminated")}>Terminate</Button>}
                          <RequestSignatureButton linkedEntityType="erp_contract" linkedEntityId={detail.id} defaultTitle={detail.title} />
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-medium text-ct-muted mb-1">Obligations</h4>
                        <div className="flex gap-2 mb-2">
                          <Input placeholder="Description" value={obligationDesc} onChange={(e) => setObligationDesc(e.target.value)} className="flex-1" />
                          <Input type="date" value={obligationDue} onChange={(e) => setObligationDue(e.target.value)} className="w-40" />
                          <Button size="sm" onClick={addObligation}><Plus className="w-3 h-3" /></Button>
                        </div>
                        <ul className="space-y-1 text-xs">
                          {detail.obligations.map((o) => (
                            <li key={o.id} className="flex items-center justify-between">
                              <span className={o.status === "completed" ? "line-through text-ct-muted" : ""}>{o.description} (due {o.dueDate})</span>
                              {o.status !== "completed" && <Button size="icon" variant="ghost" onClick={() => completeObligation(o.id)}><CheckCircle2 className="w-4 h-4 text-ct-teal" /></Button>}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <h4 className="text-xs font-medium text-ct-muted mb-1">Amendments</h4>
                        <ul className="space-y-1 text-xs">
                          {detail.amendments.length === 0 ? <li className="text-ct-muted">None</li> : detail.amendments.map((a) => (
                            <li key={a.id}>#{a.amendmentNumber} — {a.description} <Badge variant="outline" className="ml-1">{a.status}</Badge></li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <h4 className="text-xs font-medium text-ct-muted mb-1">Billing Schedules</h4>
                        <ul className="space-y-1 text-xs">
                          {detail.billingSchedules.length === 0 ? <li className="text-ct-muted">None</li> : detail.billingSchedules.map((b) => (
                            <li key={b.id}>{b.billingFrequency} — {fmt(b.amount)} next on {b.nextBillingDate}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="subscriptions">
            <div className="flex justify-end mb-2">
              <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
                <DialogTrigger asChild><Button variant="outline"><Plus className="w-4 h-4 mr-1" />New Plan</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Subscription Plan</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div><Label>Name</Label><Input value={planName} onChange={(e) => setPlanName(e.target.value)} /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Price</Label><Input type="number" value={planPrice} onChange={(e) => setPlanPrice(e.target.value)} /></div>
                      <div>
                        <Label>Billing Frequency</Label>
                        <Select value={planFrequency} onValueChange={setPlanFrequency}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem>
                            <SelectItem value="half_yearly">Half-yearly</SelectItem><SelectItem value="annually">Annually</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                  <DialogFooter><Button onClick={createPlan} disabled={creatingPlan}>{creatingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Plan"}</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Customer</th><th className="p-3 font-medium">Plan</th><th className="p-3 font-medium">Start</th><th className="p-3 font-medium">Next Renewal</th><th className="p-3 font-medium">Status</th></tr></thead>
                  <tbody className="divide-y divide-ct-border">
                    {subscriptions.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-ct-muted">No subscriptions yet. Plans available: {plans.map((p) => p.name).join(", ") || "none"}</td></tr>
                      : subscriptions.map((s) => (
                        <tr key={s.id}>
                          <td className="p-3">{customerNameById.get(s.customerId) ?? "—"}</td>
                          <td className="p-3">{planNameById.get(s.planId) ?? "—"}</td>
                          <td className="p-3">{s.startDate}</td>
                          <td className="p-3">{s.nextRenewalDate ?? "—"}</td>
                          <td className="p-3"><Badge variant="outline">{s.status}</Badge></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
