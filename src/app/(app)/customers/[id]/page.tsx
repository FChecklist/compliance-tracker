"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own CustomerOverviewClient.tsx -- the "Customer 360" view
// (opportunities/quotations/sales orders/sales invoices/linked projects/
// summary), plus the Edit and Deactivate/Reactivate flow PROJEXA's
// "real-screen conversion" (2026-08-30, R80 GAP-14) added on top of it.
// Reads the SAME GET /api/v1/projexa/customers/{id}/overview +
// GET/PATCH/DELETE /api/v1/projexa/customers/{id} this app's backend
// already serves -- getCustomerOverview()'s own return shape (raw
// erp_customers/crm_opportunities/erp_quotations/erp_sales_orders/
// erp_sales_invoices rows) is read directly here, unmapped, matching what
// that route actually returns.
//
// Rebuilt on this repo's own Card/Table/Badge, not PROJEXA's forked
// ObjectScreen (@/components/screens/KitObjectScreen) or its
// DeleteConfirmationCard -- deactivation is confirmed with a plain
// window.confirm() naming what is kept, the same pattern already used by
// src/app/(app)/compliance/[id]/page.tsx's own destructive action. GSTIN/
// PAN are shown unconditionally (no isIndiaOrg gate) -- see
// src/app/(app)/customers/page.tsx's header comment for why.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Overview = {
  customer: { id: string; customerName: string; gstin: string | null; creditLimit: string | null };
  opportunities: { id: string; name: string; stage: string; estimatedValue: string | null }[];
  quotations: { id: string; quotationNumber: number; status: string; grandTotal: string; version: number }[];
  salesOrders: { id: string; soNumber: number; status: string; grandTotal: string }[];
  salesInvoices: { id: string; invoiceNumber: number; status: string; grandTotal: string; outstandingAmount: string }[];
  linkedProjects: { id: string; name: string }[];
  summary: { lifetimeInvoiced: number; lifetimeOutstanding: number; openQuotationValue: number; openSalesOrderValue: number };
};

type CustomerDetail = {
  id: string; customerName: string; gstin: string | null; pan: string | null;
  defaultPaymentTermsDays: number | null; creditLimit: string | null; isActive: boolean;
};

export default function CustomerOverviewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const customerId = params.id;
  const currencies = useCurrencies();
  const inr = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ customerName: "", gstin: "", pan: "", defaultPaymentTermsDays: "", creditLimit: "" });
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [overviewRes, detailRes] = await Promise.all([
        fetch(`/api/v1/projexa/customers/${customerId}/overview`),
        fetch(`/api/v1/projexa/customers/${customerId}`),
      ]);
      const overviewBody = await overviewRes.json().catch(() => ({}));
      if (!overviewRes.ok) throw new Error(overviewBody.error ?? "Couldn't load customer overview");
      const detailBody = await detailRes.json().catch(() => ({}));
      if (!detailRes.ok) throw new Error(detailBody.error ?? "Couldn't load customer overview");
      setData(overviewBody as Overview);
      setIsActive(Boolean((detailBody as CustomerDetail).isActive));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't load customer overview";
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { void load(); }, [load]);

  const startEdit = async () => {
    try {
      const res = await fetch(`/api/v1/projexa/customers/${customerId}`);
      const c: CustomerDetail = await res.json();
      if (!res.ok) throw new Error((c as unknown as { error?: string }).error ?? "Couldn't load customer details");
      setDraft({
        customerName: c.customerName,
        gstin: c.gstin ?? "",
        pan: c.pan ?? "",
        defaultPaymentTermsDays: c.defaultPaymentTermsDays != null ? String(c.defaultPaymentTermsDays) : "",
        creditLimit: c.creditLimit ?? "",
      });
      setIsActive(c.isActive);
      setMode("edit");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load customer details");
    }
  };

  const saveEdit = async () => {
    if (!draft.customerName.trim()) { toast.error("Customer name is required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/projexa/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: draft.customerName.trim(),
          gstin: draft.gstin || undefined,
          pan: draft.pan || undefined,
          defaultPaymentTermsDays: draft.defaultPaymentTermsDays ? Number(draft.defaultPaymentTermsDays) : undefined,
          creditLimit: draft.creditLimit ? Number(draft.creditLimit) : undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't save customer");
      toast.success("Customer saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save customer");
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (next: boolean) => {
    setBusy(true);
    try {
      const res = next
        ? await fetch(`/api/v1/projexa/customers/${customerId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive: true }),
          })
        : await fetch(`/api/v1/projexa/customers/${customerId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? (next ? "Couldn't reactivate this customer" : "Couldn't deactivate this customer"));
      }
      toast.success(next ? "Customer reactivated" : "Customer deactivated");
      setIsActive(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : (next ? "Couldn't reactivate this customer" : "Couldn't deactivate this customer"));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = () => {
    if (!data) return;
    const keptRecords = data.opportunities.length + data.quotations.length + data.salesOrders.length + data.salesInvoices.length;
    const sentence = `Deactivate ${data.customer.customerName}? Its ${keptRecords} linked ${keptRecords === 1 ? "record is" : "records are"} kept -- opportunities, quotations, sales orders and invoices are untouched -- and you can reactivate it from this page.`;
    if (confirm(sentence)) void setActive(false);
  };

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  if (loadError) return (
    <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">Could not load this customer: {loadError}</CardContent></Card>
  );
  if (!data?.customer) return <p className="py-10 text-center text-sm text-ct-muted">Customer not found.</p>;

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/customers")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Customers
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">{mode === "edit" ? "Edit Customer" : data.customer.customerName}</h1>
            <Badge variant={isActive ? "default" : "outline"}>{isActive ? "active" : "inactive"}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {mode === "display" && isActive && (
              <Button variant="outline" size="sm" onClick={startEdit}>Edit</Button>
            )}
            {mode === "display" && !isActive && (
              <Button size="sm" disabled={busy} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={() => void setActive(true)}>
                {busy ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null} Reactivate
              </Button>
            )}
            {mode === "display" && isActive && (
              <Button variant="outline" size="sm" disabled={busy} className="text-red-700 border-red-200 hover:bg-red-50" onClick={deactivate}>
                Deactivate
              </Button>
            )}
          </div>
        </div>
        {mode === "display" && (
          <p className="text-sm text-ct-muted mt-1">GSTIN: {data.customer.gstin ?? "—"} &middot; Credit Limit: {data.customer.creditLimit ? inr(Number(data.customer.creditLimit)) : "—"}</p>
        )}
      </div>

      {mode === "edit" ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">Customer details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Customer Name</Label>
              <Input value={draft.customerName} onChange={(e) => setDraft((d) => ({ ...d, customerName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">GSTIN</Label>
                <Input value={draft.gstin} onChange={(e) => setDraft((d) => ({ ...d, gstin: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">PAN</Label>
                <Input value={draft.pan} onChange={(e) => setDraft((d) => ({ ...d, pan: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Payment Terms (days)</Label>
                <Input type="number" value={draft.defaultPaymentTermsDays} onChange={(e) => setDraft((d) => ({ ...d, defaultPaymentTermsDays: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Credit Limit</Label>
                <Input type="number" value={draft.creditLimit} onChange={(e) => setDraft((d) => ({ ...d, creditLimit: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setMode("display")} disabled={saving}>Cancel</Button>
              <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={saveEdit} disabled={saving || !draft.customerName.trim()}>
                {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : null} Save
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="rounded-xl shadow-card bg-white"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-ct-muted">Lifetime Invoiced</CardTitle></CardHeader><CardContent className="text-2xl font-semibold text-ct-navy">{inr(data.summary.lifetimeInvoiced)}</CardContent></Card>
            <Card className="rounded-xl shadow-card bg-white"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-ct-muted">Outstanding</CardTitle></CardHeader><CardContent className="text-2xl font-semibold text-ct-navy">{inr(data.summary.lifetimeOutstanding)}</CardContent></Card>
            <Card className="rounded-xl shadow-card bg-white"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-ct-muted">Open Quotations</CardTitle></CardHeader><CardContent className="text-2xl font-semibold text-ct-navy">{inr(data.summary.openQuotationValue)}</CardContent></Card>
            <Card className="rounded-xl shadow-card bg-white"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-ct-muted">Open Sales Orders</CardTitle></CardHeader><CardContent className="text-2xl font-semibold text-ct-navy">{inr(data.summary.openSalesOrderValue)}</CardContent></Card>
          </div>

          {data.linkedProjects.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.linkedProjects.map((p) => <Badge key={p.id} variant="outline">{p.name}</Badge>)}
            </div>
          )}

          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Opportunities ({data.opportunities.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {data.opportunities.length === 0 ? <p className="px-6 pb-4 text-sm text-ct-muted">None yet.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Stage</TableHead><TableHead>Value</TableHead></TableRow></TableHeader>
                  <TableBody>{data.opportunities.map((o) => (
                    <TableRow key={o.id}><TableCell>{o.name}</TableCell><TableCell><Badge variant="outline">{o.stage}</Badge></TableCell><TableCell>{o.estimatedValue ? inr(Number(o.estimatedValue)) : "—"}</TableCell></TableRow>
                  ))}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Quotations ({data.quotations.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {data.quotations.length === 0 ? <p className="px-6 pb-4 text-sm text-ct-muted">None yet.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
                  <TableBody>{data.quotations.map((q) => (
                    <TableRow key={q.id}><TableCell>{q.quotationNumber}</TableCell><TableCell>v{q.version}</TableCell><TableCell><Badge variant="outline">{q.status.replace("_", " ")}</Badge></TableCell><TableCell>{inr(Number(q.grandTotal))}</TableCell></TableRow>
                  ))}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Sales Orders ({data.salesOrders.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {data.salesOrders.length === 0 ? <p className="px-6 pb-4 text-sm text-ct-muted">None yet.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
                  <TableBody>{data.salesOrders.map((so) => (
                    <TableRow key={so.id}><TableCell>{so.soNumber}</TableCell><TableCell><Badge variant="outline">{so.status.replace("_", " ")}</Badge></TableCell><TableCell>{inr(Number(so.grandTotal))}</TableCell></TableRow>
                  ))}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Sales Invoices ({data.salesInvoices.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {data.salesInvoices.length === 0 ? <p className="px-6 pb-4 text-sm text-ct-muted">None yet.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead><TableHead>Outstanding</TableHead></TableRow></TableHeader>
                  <TableBody>{data.salesInvoices.map((inv) => (
                    <TableRow key={inv.id}><TableCell>{inv.invoiceNumber}</TableCell><TableCell><Badge variant="outline">{inv.status}</Badge></TableCell><TableCell>{inr(Number(inv.grandTotal))}</TableCell><TableCell>{inr(Number(inv.outstandingAmount))}</TableCell></TableRow>
                  ))}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
