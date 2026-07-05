"use client";

export const dynamic = "force-dynamic";

// Wave 52 (VERI ERP gap-fill, Tier 3 #11): Sales & Purchase Credit Notes.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Customer = { id: string; customerName: string };
type Supplier = { id: string; supplierName: string };
type CreditNote = { id: string; creditNoteNumber: number; postingDate: string; status: string; totalAmount: string; reason: string | null };
type Item = { description: string; quantity: string; rate: string };

const STATUS_COLORS: Record<string, string> = { draft: "bg-ct-cloud text-ct-muted", submitted: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700" };

export default function ErpCreditNotesPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [salesNotes, setSalesNotes] = useState<CreditNote[]>([]);
  const [purchaseNotes, setPurchaseNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const [salesOpen, setSalesOpen] = useState(false);
  const [salesCustomerId, setSalesCustomerId] = useState("");
  const [salesDate, setSalesDate] = useState(new Date().toISOString().slice(0, 10));
  const [salesReason, setSalesReason] = useState("");
  const [salesItems, setSalesItems] = useState<Item[]>([{ description: "", quantity: "1", rate: "" }]);
  const [creatingSales, setCreatingSales] = useState(false);

  const [purchOpen, setPurchOpen] = useState(false);
  const [purchSupplierId, setPurchSupplierId] = useState("");
  const [purchDate, setPurchDate] = useState(new Date().toISOString().slice(0, 10));
  const [purchReason, setPurchReason] = useState("");
  const [purchItems, setPurchItems] = useState<Item[]>([{ description: "", quantity: "1", rate: "" }]);
  const [creatingPurch, setCreatingPurch] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/erp/selling/customers").catch(() => null),
      fetch("/api/erp/buying/suppliers").catch(() => null),
      fetch("/api/erp/sales-credit-notes"),
      fetch("/api/erp/purchase-credit-notes"),
    ])
      .then(([custRes, supRes, salesRes, purchRes]) => Promise.all([
        custRes && custRes.ok ? custRes.json() : { customers: [] },
        supRes && supRes.ok ? supRes.json() : { suppliers: [] },
        salesRes.json(),
        purchRes.json(),
      ]))
      .then(([custData, supData, salesData, purchData]) => {
        setCustomers(custData.customers ?? []);
        setSuppliers(supData.suppliers ?? []);
        setSalesNotes(salesData.creditNotes ?? []);
        setPurchaseNotes(purchData.creditNotes ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const createSalesNote = async () => {
    setCreatingSales(true);
    const res = await fetch("/api/erp/sales-credit-notes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: salesCustomerId, postingDate: salesDate, reason: salesReason || undefined,
        items: salesItems.filter((i) => i.description).map((i) => ({ description: i.description, quantity: Number(i.quantity) || 1, rate: Number(i.rate) || 0 })),
      }),
    });
    setCreatingSales(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create credit note"); return; }
    setSalesOpen(false); setSalesReason(""); setSalesItems([{ description: "", quantity: "1", rate: "" }]);
    toast.success("Sales credit note created as draft");
    load();
  };

  const createPurchNote = async () => {
    setCreatingPurch(true);
    const res = await fetch("/api/erp/purchase-credit-notes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId: purchSupplierId, postingDate: purchDate, reason: purchReason || undefined,
        items: purchItems.filter((i) => i.description).map((i) => ({ description: i.description, quantity: Number(i.quantity) || 1, rate: Number(i.rate) || 0 })),
      }),
    });
    setCreatingPurch(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create debit note"); return; }
    setPurchOpen(false); setPurchReason(""); setPurchItems([{ description: "", quantity: "1", rate: "" }]);
    toast.success("Purchase debit note created as draft");
    load();
  };

  const submitSalesNote = async (id: string) => {
    setSubmittingId(id);
    const res = await fetch(`/api/erp/sales-credit-notes/${id}/submit`, { method: "POST" });
    setSubmittingId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to submit"); return; }
    toast.success("Submitted");
    load();
  };

  const submitPurchNote = async (id: string) => {
    setSubmittingId(id);
    const res = await fetch(`/api/erp/purchase-credit-notes/${id}/submit`, { method: "POST" });
    setSubmittingId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to submit"); return; }
    toast.success("Submitted");
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Credit Notes</h1>
        <p className="text-sm text-ct-muted mt-1">Sales credit notes &amp; purchase debit notes — VERI ERP AI</p>
      </div>

      <Tabs defaultValue="sales">
        <TabsList>
          <TabsTrigger value="sales">Sales Credit Notes</TabsTrigger>
          <TabsTrigger value="purchase">Purchase Debit Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={salesOpen} onOpenChange={setSalesOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Credit Note</Button></DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader><DialogTitle>New Sales Credit Note</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Customer</Label>
                    <Select value={salesCustomerId} onValueChange={setSalesCustomerId}>
                      <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                      <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Posting Date</Label><Input type="date" value={salesDate} onChange={(e) => setSalesDate(e.target.value)} /></div>
                    <div><Label>Reason</Label><Input value={salesReason} onChange={(e) => setSalesReason(e.target.value)} placeholder="e.g. Returned goods" /></div>
                  </div>
                  <div className="space-y-2">
                    {salesItems.map((it, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input className="flex-1" placeholder="Description" value={it.description} onChange={(e) => setSalesItems((prev) => prev.map((p, idx) => idx === i ? { ...p, description: e.target.value } : p))} />
                        <Input className="w-20" type="number" placeholder="Qty" value={it.quantity} onChange={(e) => setSalesItems((prev) => prev.map((p, idx) => idx === i ? { ...p, quantity: e.target.value } : p))} />
                        <Input className="w-28" type="number" placeholder="Rate" value={it.rate} onChange={(e) => setSalesItems((prev) => prev.map((p, idx) => idx === i ? { ...p, rate: e.target.value } : p))} />
                        <Button size="sm" variant="ghost" onClick={() => setSalesItems((prev) => prev.filter((_, idx) => idx !== i))} disabled={salesItems.length <= 1}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setSalesItems((prev) => [...prev, { description: "", quantity: "1", rate: "" }])}><Plus className="w-3 h-3 mr-1" />Add line</Button>
                  </div>
                </div>
                <DialogFooter><Button onClick={createSalesNote} disabled={creatingSales || !salesCustomerId} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingSales && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save as Draft</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">#</th><th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Amount</th><th className="p-3 font-medium">Reason</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : salesNotes.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">No sales credit notes yet.</td></tr>
                    : salesNotes.map((n) => (
                      <tr key={n.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{n.creditNoteNumber}</td><td className="p-3">{n.postingDate}</td><td className="p-3">{Number(n.totalAmount).toFixed(2)}</td><td className="p-3">{n.reason ?? "—"}</td>
                        <td className="p-3"><Badge className={STATUS_COLORS[n.status] ?? ""}>{n.status}</Badge></td>
                        <td className="p-3">{n.status === "draft" && <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={() => submitSalesNote(n.id)} disabled={submittingId === n.id}>{submittingId === n.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Submit</Button>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="purchase" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={purchOpen} onOpenChange={setPurchOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Debit Note</Button></DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader><DialogTitle>New Purchase Debit Note</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Supplier</Label>
                    <Select value={purchSupplierId} onValueChange={setPurchSupplierId}>
                      <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                      <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.supplierName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Posting Date</Label><Input type="date" value={purchDate} onChange={(e) => setPurchDate(e.target.value)} /></div>
                    <div><Label>Reason</Label><Input value={purchReason} onChange={(e) => setPurchReason(e.target.value)} placeholder="e.g. Returned to vendor" /></div>
                  </div>
                  <div className="space-y-2">
                    {purchItems.map((it, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input className="flex-1" placeholder="Description" value={it.description} onChange={(e) => setPurchItems((prev) => prev.map((p, idx) => idx === i ? { ...p, description: e.target.value } : p))} />
                        <Input className="w-20" type="number" placeholder="Qty" value={it.quantity} onChange={(e) => setPurchItems((prev) => prev.map((p, idx) => idx === i ? { ...p, quantity: e.target.value } : p))} />
                        <Input className="w-28" type="number" placeholder="Rate" value={it.rate} onChange={(e) => setPurchItems((prev) => prev.map((p, idx) => idx === i ? { ...p, rate: e.target.value } : p))} />
                        <Button size="sm" variant="ghost" onClick={() => setPurchItems((prev) => prev.filter((_, idx) => idx !== i))} disabled={purchItems.length <= 1}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setPurchItems((prev) => [...prev, { description: "", quantity: "1", rate: "" }])}><Plus className="w-3 h-3 mr-1" />Add line</Button>
                  </div>
                </div>
                <DialogFooter><Button onClick={createPurchNote} disabled={creatingPurch || !purchSupplierId} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingPurch && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save as Draft</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">#</th><th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Amount</th><th className="p-3 font-medium">Reason</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : purchaseNotes.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">No purchase debit notes yet.</td></tr>
                    : purchaseNotes.map((n) => (
                      <tr key={n.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{n.creditNoteNumber}</td><td className="p-3">{n.postingDate}</td><td className="p-3">{Number(n.totalAmount).toFixed(2)}</td><td className="p-3">{n.reason ?? "—"}</td>
                        <td className="p-3"><Badge className={STATUS_COLORS[n.status] ?? ""}>{n.status}</Badge></td>
                        <td className="p-3">{n.status === "draft" && <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={() => submitPurchNote(n.id)} disabled={submittingId === n.id}>{submittingId === n.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Submit</Button>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
