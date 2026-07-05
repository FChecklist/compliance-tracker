"use client";

export const dynamic = "force-dynamic";

// Wave 60 (Tier 3 #11 remainder + real Buying/Selling document flow):
// erp_sales_invoices/erp_purchase_invoices existed since Wave 49 with zero
// UI/service consumer until now. Submitting either posts a real, balanced
// journal entry (see erp-invoicing-service.ts).
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
type Item = { id: string; itemCode: string; itemName: string; standardSellingRate: string | null };
type Account = { id: string; accountName: string; accountType: string | null; rootType: string };
type TaxTemplate = { id: string; name: string; items: { rate: string }[] };
type Invoice = { id: string; invoiceNumber: number; postingDate: string; status: string; subtotal: string; taxAmount: string; grandTotal: string; currencyId: string | null; exchangeRate: string; customer?: { customerName: string }; supplier?: { supplierName: string } };
type PricingRule = { id: string; name: string; appliesTo: string; targetId: string | null; discountType: string; discountValue: string; validFrom: string; validTo: string | null; priority: number };
type LineItem = { itemId: string; description: string; quantity: string; rate: string; taxTemplateId: string };
type Currency = { id: string; code: string; name: string; symbol: string | null; isBaseCurrency: boolean };

const STATUS_COLORS: Record<string, string> = { draft: "bg-ct-cloud text-ct-muted", submitted: "bg-green-100 text-green-700", partially_paid: "bg-amber-100 text-amber-700", paid: "bg-green-100 text-green-700", overdue: "bg-red-100 text-red-700", cancelled: "bg-red-100 text-red-700" };

const emptyLine = (): LineItem => ({ itemId: "", description: "", quantity: "1", rate: "", taxTemplateId: "" });

export default function ErpInvoicingPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [taxTemplates, setTaxTemplates] = useState<TaxTemplate[]>([]);
  const [salesInvoices, setSalesInvoices] = useState<Invoice[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<Invoice[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [siOpen, setSiOpen] = useState(false);
  const [siCustomerId, setSiCustomerId] = useState("");
  const [siDate, setSiDate] = useState(new Date().toISOString().slice(0, 10));
  const [siItems, setSiItems] = useState<LineItem[]>([emptyLine()]);
  const [siCurrencyId, setSiCurrencyId] = useState("");
  const [siExchangeRate, setSiExchangeRate] = useState("1");
  const [creatingSi, setCreatingSi] = useState(false);
  const [siSubmitRevenueAccount, setSiSubmitRevenueAccount] = useState<Record<string, string>>({});

  const [piOpen, setPiOpen] = useState(false);
  const [piSupplierId, setPiSupplierId] = useState("");
  const [piDate, setPiDate] = useState(new Date().toISOString().slice(0, 10));
  const [piItems, setPiItems] = useState<LineItem[]>([emptyLine()]);
  const [piCurrencyId, setPiCurrencyId] = useState("");
  const [piExchangeRate, setPiExchangeRate] = useState("1");
  const [creatingPi, setCreatingPi] = useState(false);
  const [piSubmitExpenseAccount, setPiSubmitExpenseAccount] = useState<Record<string, string>>({});

  const [curOpen, setCurOpen] = useState(false);
  const [curCode, setCurCode] = useState("");
  const [curName, setCurName] = useState("");
  const [curSymbol, setCurSymbol] = useState("");
  const [curIsBase, setCurIsBase] = useState(false);
  const [creatingCur, setCreatingCur] = useState(false);

  const [prOpen, setPrOpen] = useState(false);
  const [prName, setPrName] = useState("");
  const [prAppliesTo, setPrAppliesTo] = useState<"all" | "customer" | "item">("all");
  const [prTargetId, setPrTargetId] = useState("");
  const [prDiscountType, setPrDiscountType] = useState<"percentage" | "flat">("percentage");
  const [prDiscountValue, setPrDiscountValue] = useState("");
  const [prValidFrom, setPrValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [creatingPr, setCreatingPr] = useState(false);

  const [ttOpen, setTtOpen] = useState(false);
  const [ttName, setTtName] = useState("");
  const [ttIsSales, setTtIsSales] = useState(true);
  const [ttLines, setTtLines] = useState<{ taxAccountId: string; rate: string }[]>([{ taxAccountId: "", rate: "" }]);
  const [creatingTt, setCreatingTt] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/erp/selling/customers"), fetch("/api/erp/buying/suppliers"), fetch("/api/erp/stock/items"),
      fetch("/api/erp/accounts"), fetch("/api/erp/tax-templates"), fetch("/api/erp/sales-invoices"),
      fetch("/api/erp/purchase-invoices"), fetch("/api/erp/pricing-rules"), fetch("/api/erp/currencies"),
    ])
      .then((responses) => Promise.all(responses.map((r) => r.json())))
      .then(([custData, supData, itemData, accData, taxData, siData, piData, prData, curData]) => {
        setCustomers(custData.customers ?? []);
        setSuppliers(supData.suppliers ?? []);
        setItems(itemData.items ?? []);
        setAccounts(accData.accounts ?? []);
        setTaxTemplates(taxData.templates ?? []);
        setSalesInvoices(siData.invoices ?? []);
        setPurchaseInvoices(piData.invoices ?? []);
        setPricingRules(prData.rules ?? []);
        setCurrencies(curData.currencies ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const receivableAccounts = accounts.filter((a) => a.rootType === "income" || a.accountType === "receivable");
  const payableAccounts = accounts.filter((a) => a.rootType === "expense" || a.accountType === "payable");
  const currencyCode = (id: string | null) => (id ? currencies.find((c) => c.id === id)?.code ?? "" : "");

  const createSalesInvoice = async () => {
    setCreatingSi(true);
    const res = await fetch("/api/erp/sales-invoices", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: siCustomerId, postingDate: siDate,
        currencyId: siCurrencyId || undefined, exchangeRate: siCurrencyId ? Number(siExchangeRate) || undefined : undefined,
        items: siItems.filter((i) => i.description).map((i) => ({ itemId: i.itemId || undefined, description: i.description, quantity: Number(i.quantity) || 1, rate: i.rate ? Number(i.rate) : undefined, taxTemplateId: i.taxTemplateId || undefined })),
      }),
    });
    setCreatingSi(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create sales invoice"); return; }
    setSiOpen(false); setSiItems([emptyLine()]); setSiCurrencyId(""); setSiExchangeRate("1");
    toast.success("Sales invoice created as draft");
    load();
  };

  const submitSalesInvoice = async (id: string) => {
    const revenueAccountId = siSubmitRevenueAccount[id];
    if (!revenueAccountId) { toast.error("Select a revenue account first"); return; }
    setBusyId(id);
    const res = await fetch(`/api/erp/sales-invoices/${id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revenueAccountId }) });
    setBusyId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to submit"); return; }
    toast.success("Sales invoice posted to GL");
    load();
  };

  const createPurchaseInvoice = async () => {
    setCreatingPi(true);
    const res = await fetch("/api/erp/purchase-invoices", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId: piSupplierId, postingDate: piDate,
        currencyId: piCurrencyId || undefined, exchangeRate: piCurrencyId ? Number(piExchangeRate) || undefined : undefined,
        items: piItems.filter((i) => i.description).map((i) => ({ itemId: i.itemId || undefined, description: i.description, quantity: Number(i.quantity) || 1, rate: Number(i.rate) || 0, taxTemplateId: i.taxTemplateId || undefined })),
      }),
    });
    setCreatingPi(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create purchase invoice"); return; }
    setPiOpen(false); setPiItems([emptyLine()]); setPiCurrencyId(""); setPiExchangeRate("1");
    toast.success("Purchase invoice created as draft");
    load();
  };

  const submitPurchaseInvoice = async (id: string) => {
    const expenseAccountId = piSubmitExpenseAccount[id];
    if (!expenseAccountId) { toast.error("Select an expense account first"); return; }
    setBusyId(id);
    const res = await fetch(`/api/erp/purchase-invoices/${id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expenseAccountId }) });
    setBusyId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to submit"); return; }
    toast.success("Purchase invoice posted to GL");
    load();
  };

  const createPricingRule = async () => {
    setCreatingPr(true);
    const res = await fetch("/api/erp/pricing-rules", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: prName, appliesTo: prAppliesTo, targetId: prTargetId || undefined, discountType: prDiscountType, discountValue: Number(prDiscountValue) || 0, validFrom: prValidFrom }),
    });
    setCreatingPr(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create pricing rule"); return; }
    setPrOpen(false); setPrName(""); setPrTargetId(""); setPrDiscountValue("");
    toast.success("Pricing rule saved");
    load();
  };

  const createTaxTemplate = async () => {
    setCreatingTt(true);
    const res = await fetch("/api/erp/tax-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: ttName, isSalesTax: ttIsSales, isPurchaseTax: !ttIsSales, items: ttLines.filter((l) => l.taxAccountId).map((l) => ({ taxAccountId: l.taxAccountId, rate: Number(l.rate) || 0 })) }),
    });
    setCreatingTt(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create tax template"); return; }
    setTtOpen(false); setTtName(""); setTtLines([{ taxAccountId: "", rate: "" }]);
    toast.success("Tax template saved");
    load();
  };

  const createCurrency = async () => {
    setCreatingCur(true);
    const res = await fetch("/api/erp/currencies", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: curCode, name: curName, symbol: curSymbol || undefined, isBaseCurrency: curIsBase }),
    });
    setCreatingCur(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create currency"); return; }
    setCurOpen(false); setCurCode(""); setCurName(""); setCurSymbol(""); setCurIsBase(false);
    toast.success("Currency saved");
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Invoicing</h1>
        <p className="text-sm text-ct-muted mt-1">Sales &amp; purchase invoices, pricing rules, GST tax templates — VERI ERP AI</p>
      </div>

      <Tabs defaultValue="sales">
        <TabsList>
          <TabsTrigger value="sales">Sales Invoices</TabsTrigger>
          <TabsTrigger value="purchase">Purchase Invoices</TabsTrigger>
          <TabsTrigger value="pricing">Pricing Rules</TabsTrigger>
          <TabsTrigger value="tax">Tax Templates</TabsTrigger>
          <TabsTrigger value="currencies">Currencies</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={siOpen} onOpenChange={setSiOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Sales Invoice</Button></DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>New Sales Invoice</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Customer</Label>
                      <Select value={siCustomerId} onValueChange={setSiCustomerId}>
                        <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                        <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Posting Date</Label><Input type="date" value={siDate} onChange={(e) => setSiDate(e.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Currency (optional -- leave blank for base currency)</Label>
                      <Select value={siCurrencyId || "__base__"} onValueChange={(v) => setSiCurrencyId(v === "__base__" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder="Base currency" /></SelectTrigger>
                        <SelectContent><SelectItem value="__base__">Base currency</SelectItem>{currencies.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} -- {c.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {siCurrencyId && (
                      <div><Label>Exchange Rate (to base currency)</Label><Input type="number" step="0.0001" value={siExchangeRate} onChange={(e) => setSiExchangeRate(e.target.value)} placeholder="e.g. 83.25" /></div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Line Items (leave rate blank to auto-price from item + pricing rules)</Label>
                    {siItems.map((it, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Select value={it.itemId || "__none__"} onValueChange={(v) => setSiItems((prev) => prev.map((p, idx) => idx === i ? { ...p, itemId: v === "__none__" ? "" : v, description: p.description || (items.find((x) => x.id === v)?.itemName ?? "") } : p))}>
                          <SelectTrigger className="w-40"><SelectValue placeholder="Item (optional)" /></SelectTrigger>
                          <SelectContent><SelectItem value="__none__">—</SelectItem>{items.map((it2) => <SelectItem key={it2.id} value={it2.id}>{it2.itemCode}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input className="flex-1" placeholder="Description" value={it.description} onChange={(e) => setSiItems((prev) => prev.map((p, idx) => idx === i ? { ...p, description: e.target.value } : p))} />
                        <Input className="w-16" type="number" placeholder="Qty" value={it.quantity} onChange={(e) => setSiItems((prev) => prev.map((p, idx) => idx === i ? { ...p, quantity: e.target.value } : p))} />
                        <Input className="w-24" type="number" placeholder="Rate (auto)" value={it.rate} onChange={(e) => setSiItems((prev) => prev.map((p, idx) => idx === i ? { ...p, rate: e.target.value } : p))} />
                        <Select value={it.taxTemplateId || "__none__"} onValueChange={(v) => setSiItems((prev) => prev.map((p, idx) => idx === i ? { ...p, taxTemplateId: v === "__none__" ? "" : v } : p))}>
                          <SelectTrigger className="w-28"><SelectValue placeholder="Tax" /></SelectTrigger>
                          <SelectContent><SelectItem value="__none__">No tax</SelectItem>{taxTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <Button size="sm" variant="ghost" onClick={() => setSiItems((prev) => prev.filter((_, idx) => idx !== i))} disabled={siItems.length <= 1}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setSiItems((prev) => [...prev, emptyLine()])}><Plus className="w-3 h-3 mr-1" />Add line</Button>
                  </div>
                </div>
                <DialogFooter><Button onClick={createSalesInvoice} disabled={creatingSi || !siCustomerId} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingSi && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save as Draft</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">#</th><th className="p-3 font-medium">Customer</th><th className="p-3 font-medium">Date</th><th className="p-3 font-medium text-right">Grand Total</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : salesInvoices.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">No sales invoices yet.</td></tr>
                    : salesInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{inv.invoiceNumber}</td><td className="p-3">{inv.customer?.customerName ?? "—"}</td><td className="p-3">{inv.postingDate}</td>
                        <td className="p-3 text-right">{Number(inv.grandTotal).toFixed(2)}{inv.currencyId ? ` ${currencyCode(inv.currencyId)}` : ""}</td>
                        <td className="p-3"><Badge className={STATUS_COLORS[inv.status] ?? ""}>{inv.status}</Badge></td>
                        <td className="p-3">
                          {inv.status === "draft" && (
                            <div className="flex gap-1 items-center">
                              <Select value={siSubmitRevenueAccount[inv.id] ?? ""} onValueChange={(v) => setSiSubmitRevenueAccount((prev) => ({ ...prev, [inv.id]: v }))}>
                                <SelectTrigger className="w-32 h-7 text-xs"><SelectValue placeholder="Revenue a/c" /></SelectTrigger>
                                <SelectContent>{receivableAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>)}</SelectContent>
                              </Select>
                              <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={() => submitSalesInvoice(inv.id)} disabled={busyId === inv.id}>{busyId === inv.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Post</Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="purchase" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={piOpen} onOpenChange={setPiOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Purchase Invoice</Button></DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>New Purchase Invoice</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Supplier</Label>
                      <Select value={piSupplierId} onValueChange={setPiSupplierId}>
                        <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                        <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.supplierName}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Posting Date</Label><Input type="date" value={piDate} onChange={(e) => setPiDate(e.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Currency (optional -- leave blank for base currency)</Label>
                      <Select value={piCurrencyId || "__base__"} onValueChange={(v) => setPiCurrencyId(v === "__base__" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder="Base currency" /></SelectTrigger>
                        <SelectContent><SelectItem value="__base__">Base currency</SelectItem>{currencies.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} -- {c.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {piCurrencyId && (
                      <div><Label>Exchange Rate (to base currency)</Label><Input type="number" step="0.0001" value={piExchangeRate} onChange={(e) => setPiExchangeRate(e.target.value)} placeholder="e.g. 83.25" /></div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Line Items</Label>
                    {piItems.map((it, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Select value={it.itemId || "__none__"} onValueChange={(v) => setPiItems((prev) => prev.map((p, idx) => idx === i ? { ...p, itemId: v === "__none__" ? "" : v, description: p.description || (items.find((x) => x.id === v)?.itemName ?? "") } : p))}>
                          <SelectTrigger className="w-40"><SelectValue placeholder="Item (optional)" /></SelectTrigger>
                          <SelectContent><SelectItem value="__none__">—</SelectItem>{items.map((it2) => <SelectItem key={it2.id} value={it2.id}>{it2.itemCode}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input className="flex-1" placeholder="Description" value={it.description} onChange={(e) => setPiItems((prev) => prev.map((p, idx) => idx === i ? { ...p, description: e.target.value } : p))} />
                        <Input className="w-16" type="number" placeholder="Qty" value={it.quantity} onChange={(e) => setPiItems((prev) => prev.map((p, idx) => idx === i ? { ...p, quantity: e.target.value } : p))} />
                        <Input className="w-24" type="number" placeholder="Rate" value={it.rate} onChange={(e) => setPiItems((prev) => prev.map((p, idx) => idx === i ? { ...p, rate: e.target.value } : p))} />
                        <Select value={it.taxTemplateId || "__none__"} onValueChange={(v) => setPiItems((prev) => prev.map((p, idx) => idx === i ? { ...p, taxTemplateId: v === "__none__" ? "" : v } : p))}>
                          <SelectTrigger className="w-28"><SelectValue placeholder="Tax" /></SelectTrigger>
                          <SelectContent><SelectItem value="__none__">No tax</SelectItem>{taxTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <Button size="sm" variant="ghost" onClick={() => setPiItems((prev) => prev.filter((_, idx) => idx !== i))} disabled={piItems.length <= 1}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setPiItems((prev) => [...prev, emptyLine()])}><Plus className="w-3 h-3 mr-1" />Add line</Button>
                  </div>
                </div>
                <DialogFooter><Button onClick={createPurchaseInvoice} disabled={creatingPi || !piSupplierId} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingPi && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save as Draft</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">#</th><th className="p-3 font-medium">Supplier</th><th className="p-3 font-medium">Date</th><th className="p-3 font-medium text-right">Grand Total</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : purchaseInvoices.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">No purchase invoices yet.</td></tr>
                    : purchaseInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{inv.invoiceNumber}</td><td className="p-3">{inv.supplier?.supplierName ?? "—"}</td><td className="p-3">{inv.postingDate}</td>
                        <td className="p-3 text-right">{Number(inv.grandTotal).toFixed(2)}{inv.currencyId ? ` ${currencyCode(inv.currencyId)}` : ""}</td>
                        <td className="p-3"><Badge className={STATUS_COLORS[inv.status] ?? ""}>{inv.status}</Badge></td>
                        <td className="p-3">
                          {inv.status === "draft" && (
                            <div className="flex gap-1 items-center">
                              <Select value={piSubmitExpenseAccount[inv.id] ?? ""} onValueChange={(v) => setPiSubmitExpenseAccount((prev) => ({ ...prev, [inv.id]: v }))}>
                                <SelectTrigger className="w-32 h-7 text-xs"><SelectValue placeholder="Expense a/c" /></SelectTrigger>
                                <SelectContent>{payableAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>)}</SelectContent>
                              </Select>
                              <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={() => submitPurchaseInvoice(inv.id)} disabled={busyId === inv.id}>{busyId === inv.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Post</Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pricing" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={prOpen} onOpenChange={setPrOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Pricing Rule</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Pricing Rule</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Name</Label><Input value={prName} onChange={(e) => setPrName(e.target.value)} placeholder="e.g. Diwali Sale 2026" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Applies To</Label>
                      <Select value={prAppliesTo} onValueChange={(v) => setPrAppliesTo(v as typeof prAppliesTo)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="all">All sales</SelectItem><SelectItem value="customer">Specific customer</SelectItem><SelectItem value="item">Specific item</SelectItem></SelectContent>
                      </Select>
                    </div>
                    {prAppliesTo === "customer" && (
                      <div><Label>Customer</Label>
                        <Select value={prTargetId} onValueChange={setPrTargetId}>
                          <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                          <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                    {prAppliesTo === "item" && (
                      <div><Label>Item</Label>
                        <Select value={prTargetId} onValueChange={setPrTargetId}>
                          <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                          <SelectContent>{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.itemCode}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Discount Type</Label>
                      <Select value={prDiscountType} onValueChange={(v) => setPrDiscountType(v as typeof prDiscountType)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="percentage">% off</SelectItem><SelectItem value="flat">Flat amount off</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div><Label>Discount Value</Label><Input type="number" value={prDiscountValue} onChange={(e) => setPrDiscountValue(e.target.value)} /></div>
                    <div><Label>Valid From</Label><Input type="date" value={prValidFrom} onChange={(e) => setPrValidFrom(e.target.value)} /></div>
                  </div>
                </div>
                <DialogFooter><Button onClick={createPricingRule} disabled={creatingPr || !prName} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingPr && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Applies To</th><th className="p-3 font-medium">Discount</th><th className="p-3 font-medium">Valid From</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {pricingRules.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">No pricing rules configured yet.</td></tr>
                    : pricingRules.map((r) => (
                      <tr key={r.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{r.name}</td><td className="p-3">{r.appliesTo}</td>
                        <td className="p-3">{r.discountType === "percentage" ? `${r.discountValue}%` : r.discountValue} off</td>
                        <td className="p-3">{r.validFrom}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={ttOpen} onOpenChange={setTtOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Tax Template</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Tax Template</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Name</Label><Input value={ttName} onChange={(e) => setTtName(e.target.value)} placeholder="e.g. GST 18% (CGST+SGST)" /></div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ttIsSales} onChange={(e) => setTtIsSales(e.target.checked)} />Sales tax (uncheck for purchase tax)</label>
                  <div className="space-y-2">
                    <Label>Tax Lines (e.g. CGST 9%, SGST 9%)</Label>
                    {ttLines.map((l, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Select value={l.taxAccountId} onValueChange={(v) => setTtLines((prev) => prev.map((p, idx) => idx === i ? { ...p, taxAccountId: v } : p))}>
                          <SelectTrigger className="flex-1"><SelectValue placeholder="Tax GL account" /></SelectTrigger>
                          <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input className="w-24" type="number" placeholder="Rate %" value={l.rate} onChange={(e) => setTtLines((prev) => prev.map((p, idx) => idx === i ? { ...p, rate: e.target.value } : p))} />
                        <Button size="sm" variant="ghost" onClick={() => setTtLines((prev) => prev.filter((_, idx) => idx !== i))} disabled={ttLines.length <= 1}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setTtLines((prev) => [...prev, { taxAccountId: "", rate: "" }])}><Plus className="w-3 h-3 mr-1" />Add tax line</Button>
                  </div>
                </div>
                <DialogFooter><Button onClick={createTaxTemplate} disabled={creatingTt || !ttName} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingTt && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Combined Rate</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {taxTemplates.length === 0 ? <tr><td colSpan={2} className="p-6 text-center text-ct-muted">No tax templates yet.</td></tr>
                    : taxTemplates.map((t) => <tr key={t.id} className="hover:bg-ct-row-hover"><td className="p-3">{t.name}</td><td className="p-3">{t.items.reduce((sum, i) => sum + Number(i.rate), 0)}%</td></tr>)}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="currencies" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={curOpen} onOpenChange={setCurOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Currency</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Currency</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Code (ISO 4217)</Label><Input value={curCode} onChange={(e) => setCurCode(e.target.value.toUpperCase())} placeholder="e.g. USD" maxLength={3} /></div>
                    <div><Label>Symbol</Label><Input value={curSymbol} onChange={(e) => setCurSymbol(e.target.value)} placeholder="e.g. $" /></div>
                  </div>
                  <div><Label>Name</Label><Input value={curName} onChange={(e) => setCurName(e.target.value)} placeholder="e.g. US Dollar" /></div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={curIsBase} onChange={(e) => setCurIsBase(e.target.checked)} />Set as base currency (unsets any existing base currency)</label>
                </div>
                <DialogFooter><Button onClick={createCurrency} disabled={creatingCur || !curCode || !curName} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingCur && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Code</th><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Symbol</th><th className="p-3 font-medium">Base?</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {currencies.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">No currencies configured yet -- an org must set these up before invoicing in a non-base currency.</td></tr>
                    : currencies.map((c) => (
                      <tr key={c.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{c.code}</td><td className="p-3">{c.name}</td><td className="p-3">{c.symbol ?? "—"}</td>
                        <td className="p-3">{c.isBaseCurrency ? <Badge className="bg-green-100 text-green-700">Base</Badge> : ""}</td>
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
