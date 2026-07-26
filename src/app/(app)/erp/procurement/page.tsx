"use client";

export const dynamic = "force-dynamic";

// Wave 55 (VERI ERP gap-fill, Tier 3 #10): Procurement Workflow above the
// PO -- Purchase Requisition -> RFQ -> Supplier Quotation comparison.
// Requisition submit is wired to the shared Approval Workflow Engine as its
// second real consumer (see erp-procurement-workflow-service.ts).
//
// Wave 7 (PROJEXA reconcile, procurement workflow depth): the one real gap
// versus PROJEXA's own procurement page (which this wave's module-mapping
// report otherwise found CT already exceeds -- Compare Quotes, weighted
// scoring, negotiation rounds, and reverse auctions all have no PROJEXA
// equivalent) was a one-click "quotation -> PO" action. PROJEXA's
// ProcurementClient.tsx has exactly that and nothing deeper, so this adds
// the same single action here rather than a fuller PO-authoring flow --
// it POSTs to the existing /api/erp/buying/purchase-orders route
// (erp-buying-service.ts's createPurchaseOrder), the same endpoint the
// Goods Receipt page's own "New Purchase Order" dialog already uses.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Supplier = { id: string; supplierName: string };
type Requisition = { id: string; requisitionNumber: number; postingDate: string; purpose: string | null; status: string; items: { description: string; quantity: string; estimatedRate: string | null }[] };
type Rfq = { id: string; rfqNumber: number; postingDate: string; status: string; items: { description: string; quantity: string }[]; suppliers: { supplierId: string }[] };
type Quotation = { id: string; quotationNumber: number; postingDate: string; status: string; supplierId: string; supplier: { supplierName: string } | null; items: { description: string; quantity: string; rate: string }[]; total?: number };
type LineItem = { description: string; quantity: string; rate: string };

const REQ_STATUS_COLORS: Record<string, string> = { draft: "bg-ct-cloud text-ct-muted", submitted: "bg-amber-100 text-amber-700", approved: "bg-green-100 text-green-700", rejected: "bg-red-100 text-red-700", converted: "bg-blue-100 text-blue-700" };
const RFQ_STATUS_COLORS: Record<string, string> = { draft: "bg-ct-cloud text-ct-muted", sent: "bg-amber-100 text-amber-700", closed: "bg-green-100 text-green-700" };

export default function ErpProcurementPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [compareRfqId, setCompareRfqId] = useState<string>("");
  const [compareResults, setCompareResults] = useState<Quotation[]>([]);

  const [reqOpen, setReqOpen] = useState(false);
  const [reqPurpose, setReqPurpose] = useState("");
  const [reqDate, setReqDate] = useState(new Date().toISOString().slice(0, 10));
  const [reqItems, setReqItems] = useState<LineItem[]>([{ description: "", quantity: "1", rate: "" }]);
  const [creatingReq, setCreatingReq] = useState(false);

  const [rfqOpen, setRfqOpen] = useState(false);
  const [rfqDate, setRfqDate] = useState(new Date().toISOString().slice(0, 10));
  const [rfqItems, setRfqItems] = useState<LineItem[]>([{ description: "", quantity: "1", rate: "" }]);
  const [rfqSupplierIds, setRfqSupplierIds] = useState<string[]>([]);
  const [creatingRfq, setCreatingRfq] = useState(false);

  const [qOpen, setQOpen] = useState(false);
  const [qRfqId, setQRfqId] = useState("");
  const [qSupplierId, setQSupplierId] = useState("");
  const [qDate, setQDate] = useState(new Date().toISOString().slice(0, 10));
  const [qItems, setQItems] = useState<LineItem[]>([{ description: "", quantity: "1", rate: "" }]);
  const [creatingQ, setCreatingQ] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/erp/buying/suppliers").catch(() => null),
      fetch("/api/erp/procurement/requisitions"),
      fetch("/api/erp/procurement/rfqs"),
      fetch("/api/erp/procurement/quotations"),
    ])
      .then(([supRes, reqRes, rfqRes, qRes]) => Promise.all([
        supRes && supRes.ok ? supRes.json() : { suppliers: [] },
        reqRes.json(), rfqRes.json(), qRes.json(),
      ]))
      .then(([supData, reqData, rfqData, qData]) => {
        setSuppliers(supData.suppliers ?? []);
        setRequisitions(reqData.requisitions ?? []);
        setRfqs(rfqData.rfqs ?? []);
        setQuotations(qData.quotations ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const createRequisition = async () => {
    setCreatingReq(true);
    const res = await fetch("/api/erp/procurement/requisitions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purpose: reqPurpose || undefined, postingDate: reqDate,
        items: reqItems.filter((i) => i.description).map((i) => ({ description: i.description, quantity: Number(i.quantity) || 1, estimatedRate: i.rate ? Number(i.rate) : undefined })),
      }),
    });
    setCreatingReq(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create requisition"); return; }
    setReqOpen(false); setReqPurpose(""); setReqItems([{ description: "", quantity: "1", rate: "" }]);
    toast.success("Purchase requisition created as draft");
    load();
  };

  const submitRequisition = async (id: string) => {
    setBusyId(id);
    const res = await fetch(`/api/erp/procurement/requisitions/${id}/submit`, { method: "POST" });
    setBusyId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to submit"); return; }
    const d = await res.json();
    toast.success(d.pendingApproval ? "Submitted for approval" : "Approved (no workflow configured)");
    load();
  };

  const createRfq = async () => {
    setCreatingRfq(true);
    const res = await fetch("/api/erp/procurement/rfqs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postingDate: rfqDate,
        items: rfqItems.filter((i) => i.description).map((i) => ({ description: i.description, quantity: Number(i.quantity) || 1 })),
        supplierIds: rfqSupplierIds,
      }),
    });
    setCreatingRfq(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create RFQ"); return; }
    setRfqOpen(false); setRfqItems([{ description: "", quantity: "1", rate: "" }]); setRfqSupplierIds([]);
    toast.success("RFQ created as draft");
    load();
  };

  const sendRfq = async (id: string) => {
    setBusyId(id);
    const res = await fetch(`/api/erp/procurement/rfqs/${id}/send`, { method: "POST" });
    setBusyId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to send"); return; }
    toast.success("RFQ sent");
    load();
  };

  const createQuotation = async () => {
    setCreatingQ(true);
    const res = await fetch("/api/erp/procurement/quotations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rfqId: qRfqId || undefined, supplierId: qSupplierId, postingDate: qDate,
        items: qItems.filter((i) => i.description).map((i) => ({ description: i.description, quantity: Number(i.quantity) || 1, rate: Number(i.rate) || 0 })),
      }),
    });
    setCreatingQ(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to record quotation"); return; }
    setQOpen(false); setQItems([{ description: "", quantity: "1", rate: "" }]);
    toast.success("Supplier quotation recorded");
    load();
  };

  const runCompare = async (rfqId: string) => {
    setCompareRfqId(rfqId);
    const res = await fetch(`/api/erp/procurement/rfqs/${rfqId}/quotations`);
    const d = await res.json();
    setCompareResults(d.quotations ?? []);
  };

  // Wave 7 (PROJEXA reconcile): mirrors PROJEXA's ProcurementClient.tsx
  // convertToPo() exactly -- one-click PO creation from a quotation's own
  // supplier + line items, via the same /api/erp/buying/purchase-orders
  // route the Goods Receipt page's manual "New Purchase Order" dialog uses.
  const convertToPo = async (q: Quotation) => {
    setConvertingId(q.id);
    const res = await fetch("/api/erp/buying/purchase-orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId: q.supplierId, orderDate: new Date().toISOString().slice(0, 10),
        items: q.items.map((i) => ({ description: i.description, quantity: Number(i.quantity), rate: Number(i.rate) })),
      }),
    });
    setConvertingId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to convert quotation to a purchase order"); return; }
    toast.success("Purchase order created as draft — manage it on the Goods Receipt page");
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Procurement Workflow</h1>
        <p className="text-sm text-ct-muted mt-1">Requisition → RFQ → Supplier quotation comparison, above the purchase order — VERI ERP AI</p>
      </div>

      <Tabs defaultValue="requisitions">
        <TabsList>
          <TabsTrigger value="requisitions">Purchase Requisitions</TabsTrigger>
          <TabsTrigger value="rfqs">RFQs</TabsTrigger>
          <TabsTrigger value="quotations">Supplier Quotations</TabsTrigger>
        </TabsList>

        <TabsContent value="requisitions" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={reqOpen} onOpenChange={setReqOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Requisition</Button></DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader><DialogTitle>New Purchase Requisition</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Posting Date</Label><Input type="date" value={reqDate} onChange={(e) => setReqDate(e.target.value)} /></div>
                    <div><Label>Purpose</Label><Input value={reqPurpose} onChange={(e) => setReqPurpose(e.target.value)} placeholder="e.g. Office supplies restock" /></div>
                  </div>
                  <div className="space-y-2">
                    {reqItems.map((it, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input className="flex-1" placeholder="Description" value={it.description} onChange={(e) => setReqItems((prev) => prev.map((p, idx) => idx === i ? { ...p, description: e.target.value } : p))} />
                        <Input className="w-20" type="number" placeholder="Qty" value={it.quantity} onChange={(e) => setReqItems((prev) => prev.map((p, idx) => idx === i ? { ...p, quantity: e.target.value } : p))} />
                        <Input className="w-28" type="number" placeholder="Est. Rate" value={it.rate} onChange={(e) => setReqItems((prev) => prev.map((p, idx) => idx === i ? { ...p, rate: e.target.value } : p))} />
                        <Button size="sm" variant="ghost" onClick={() => setReqItems((prev) => prev.filter((_, idx) => idx !== i))} disabled={reqItems.length <= 1}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setReqItems((prev) => [...prev, { description: "", quantity: "1", rate: "" }])}><Plus className="w-3 h-3 mr-1" />Add line</Button>
                  </div>
                </div>
                <DialogFooter><Button onClick={createRequisition} disabled={creatingReq} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingReq && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save as Draft</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">#</th><th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Purpose</th><th className="p-3 font-medium">Lines</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : requisitions.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">No purchase requisitions yet.</td></tr>
                    : requisitions.map((r) => (
                      <tr key={r.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{r.requisitionNumber}</td><td className="p-3">{r.postingDate}</td><td className="p-3">{r.purpose ?? "—"}</td><td className="p-3">{r.items.length}</td>
                        <td className="p-3"><Badge className={REQ_STATUS_COLORS[r.status] ?? ""}>{r.status}</Badge></td>
                        <td className="p-3">{r.status === "draft" && <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={() => submitRequisition(r.id)} disabled={busyId === r.id}>{busyId === r.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Submit</Button>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rfqs" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={rfqOpen} onOpenChange={setRfqOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New RFQ</Button></DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader><DialogTitle>New Request for Quotation</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Posting Date</Label><Input type="date" value={rfqDate} onChange={(e) => setRfqDate(e.target.value)} /></div>
                  <div>
                    <Label>Suppliers to invite</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {suppliers.map((s) => (
                        <Button key={s.id} size="sm" type="button" variant={rfqSupplierIds.includes(s.id) ? "default" : "outline"}
                          className={rfqSupplierIds.includes(s.id) ? "h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" : "h-7 text-xs"}
                          onClick={() => setRfqSupplierIds((prev) => prev.includes(s.id) ? prev.filter((id) => id !== s.id) : [...prev, s.id])}>
                          {s.supplierName}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {rfqItems.map((it, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input className="flex-1" placeholder="Description" value={it.description} onChange={(e) => setRfqItems((prev) => prev.map((p, idx) => idx === i ? { ...p, description: e.target.value } : p))} />
                        <Input className="w-20" type="number" placeholder="Qty" value={it.quantity} onChange={(e) => setRfqItems((prev) => prev.map((p, idx) => idx === i ? { ...p, quantity: e.target.value } : p))} />
                        <Button size="sm" variant="ghost" onClick={() => setRfqItems((prev) => prev.filter((_, idx) => idx !== i))} disabled={rfqItems.length <= 1}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setRfqItems((prev) => [...prev, { description: "", quantity: "1", rate: "" }])}><Plus className="w-3 h-3 mr-1" />Add line</Button>
                  </div>
                </div>
                <DialogFooter><Button onClick={createRfq} disabled={creatingRfq || rfqSupplierIds.length === 0} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingRfq && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save as Draft</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">#</th><th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Lines</th><th className="p-3 font-medium">Suppliers</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : rfqs.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">No RFQs yet.</td></tr>
                    : rfqs.map((q) => (
                      <tr key={q.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{q.rfqNumber}</td><td className="p-3">{q.postingDate}</td><td className="p-3">{q.items.length}</td><td className="p-3">{q.suppliers.length}</td>
                        <td className="p-3"><Badge className={RFQ_STATUS_COLORS[q.status] ?? ""}>{q.status}</Badge></td>
                        <td className="p-3 flex gap-2">
                          {q.status === "draft" && <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={() => sendRfq(q.id)} disabled={busyId === q.id}>{busyId === q.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Send</Button>}
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => runCompare(q.id)}>Compare Quotes</Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {compareRfqId && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4 space-y-2">
                <h3 className="text-sm font-medium text-ct-navy">Quotation Comparison (lowest total first)</h3>
                {compareResults.length === 0 ? <p className="text-xs text-ct-muted">No quotations received yet for this RFQ.</p> : (
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-2 font-medium">Rank</th><th className="p-2 font-medium">Supplier</th><th className="p-2 font-medium">Quote #</th><th className="p-2 font-medium">Date</th><th className="p-2 font-medium text-right">Total</th><th className="p-2 font-medium"></th></tr></thead>
                    <tbody className="divide-y divide-ct-border">
                      {compareResults.map((c, i) => (
                        <tr key={c.id} className={i === 0 ? "bg-green-50" : ""}>
                          <td className="p-2">{i + 1}</td><td className="p-2">{c.supplier?.supplierName ?? "—"}</td><td className="p-2">{c.quotationNumber}</td><td className="p-2">{c.postingDate}</td>
                          <td className="p-2 text-right font-medium">{(c.total ?? 0).toFixed(2)}</td>
                          <td className="p-2 text-right">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => convertToPo(c)} disabled={convertingId === c.id}>
                              {convertingId === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />} Convert to PO
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="quotations" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={qOpen} onOpenChange={setQOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />Record Quotation</Button></DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader><DialogTitle>Record Supplier Quotation</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>RFQ (optional)</Label>
                      <Select value={qRfqId} onValueChange={setQRfqId}>
                        <SelectTrigger><SelectValue placeholder="Not linked to an RFQ" /></SelectTrigger>
                        <SelectContent>{rfqs.map((r) => <SelectItem key={r.id} value={r.id}>RFQ #{r.rfqNumber}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Supplier</Label>
                      <Select value={qSupplierId} onValueChange={setQSupplierId}>
                        <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                        <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.supplierName}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div><Label>Posting Date</Label><Input type="date" value={qDate} onChange={(e) => setQDate(e.target.value)} /></div>
                  <div className="space-y-2">
                    {qItems.map((it, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input className="flex-1" placeholder="Description" value={it.description} onChange={(e) => setQItems((prev) => prev.map((p, idx) => idx === i ? { ...p, description: e.target.value } : p))} />
                        <Input className="w-20" type="number" placeholder="Qty" value={it.quantity} onChange={(e) => setQItems((prev) => prev.map((p, idx) => idx === i ? { ...p, quantity: e.target.value } : p))} />
                        <Input className="w-28" type="number" placeholder="Rate" value={it.rate} onChange={(e) => setQItems((prev) => prev.map((p, idx) => idx === i ? { ...p, rate: e.target.value } : p))} />
                        <Button size="sm" variant="ghost" onClick={() => setQItems((prev) => prev.filter((_, idx) => idx !== i))} disabled={qItems.length <= 1}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setQItems((prev) => [...prev, { description: "", quantity: "1", rate: "" }])}><Plus className="w-3 h-3 mr-1" />Add line</Button>
                  </div>
                </div>
                <DialogFooter><Button onClick={createQuotation} disabled={creatingQ || !qSupplierId} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingQ && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">#</th><th className="p-3 font-medium">Supplier</th><th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Lines</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : quotations.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">No supplier quotations recorded yet.</td></tr>
                    : quotations.map((q) => (
                      <tr key={q.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{q.quotationNumber}</td><td className="p-3">{q.supplier?.supplierName ?? "—"}</td><td className="p-3">{q.postingDate}</td><td className="p-3">{q.items.length}</td>
                        <td className="p-3"><Badge className="bg-ct-cloud text-ct-muted">{q.status}</Badge></td>
                        <td className="p-3">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => convertToPo(q)} disabled={convertingId === q.id}>
                            {convertingId === q.id ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />} Convert to PO
                          </Button>
                        </td>
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
