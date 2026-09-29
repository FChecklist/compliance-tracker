"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own Invoicing module (src/app/(app)/invoices/page.tsx +
// InvoicesClient.tsx there -- 3 tabs: Invoices, Credit Notes, AR Aging).
// Reads the already-native /api/v1/projexa/sales-invoices,
// /api/v1/projexa/credit-notes and /api/v1/projexa/ar-aging -- zero new
// backend route, zero HTTP hop to a separate origin (verified field-for-
// field against each route.ts and erp-invoicing-service.ts/
// erp-credit-note-service.ts before writing this file).
//
// Naming note: PROJEXA's page is called "invoices" but the real backend
// resource is "sales-invoices" (erp_sales_invoices) -- this port keeps
// PROJEXA's own URL (/invoices) since that is a genuinely new top-level
// route in this repo (no pre-existing /invoices or erp/*invoice* PAGE --
// confirmed via a repo-wide check before writing this file; erp/sales-
// invoices/purchase-invoices only exist as API routes, not pages).
//
// UI is compliance-tracker's own shadcn Tabs/Table/Card/Select (matching the
// house convention every already-ported PROJEXA-merge page uses: see
// src/app/(app)/employees/page.tsx for the same tabbed, URL-synced pattern),
// not PROJEXA's @fchecklist/veridian-ui-kit ScreenFrame/ListScreen, and real
// create routes (new/, credit-notes/new/) rather than Dialog popups --
// matching PROJEXA's own 2026-08-30 "real-screen conversion" of this exact
// module.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Invoice = {
  id: string; invoiceNumber: number; customerId: string; customerName: string | null;
  postingDate: string; dueDate: string | null; grandTotal: string; outstandingAmount: string; status: string;
};
type CreditNote = {
  id: string; creditNoteNumber: number; customerId: string; salesInvoiceId: string | null;
  postingDate: string; reason: string | null; status: string; totalAmount: string;
};
type AgingInvoiceRow = {
  invoiceId: string; invoiceNumber: number; customerName: string | null; dueDate: string | null;
  outstandingAmount: string; daysOverdue: number; bucket: string;
};
type AgingReport = {
  asOfDate: string; totalOutstanding: number;
  buckets: { current: number; d1_30: number; d31_60: number; d61_90: number; d90Plus: number };
  invoices: AgingInvoiceRow[];
};

const INVOICE_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", partially_paid: "secondary", paid: "default", overdue: "destructive", cancelled: "outline",
};
const VALID_TABS = new Set(["invoices", "credit-notes", "aging"]);

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

async function fetchOk<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Couldn't load ${what} (HTTP ${res.status})`);
  return body as T;
}

function InvoicesPanel() {
  const router = useRouter();
  const currencies = useCurrencies();
  const money = (v: string | number) => `${currencyLabel(undefined, currencies)}${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const data = await fetchOk<{ salesInvoices?: Invoice[]; totalPages?: number }>(
        `/api/v1/projexa/sales-invoices?${params.toString()}`, "invoices"
      );
      setInvoices(data.salesInvoices ?? []);
      setTotalPages(data.totalPages ?? 1);
      setLoadError(null);
    } catch (err) {
      setInvoices([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load invoices");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {["draft", "submitted", "partially_paid", "paid", "overdue", "cancelled"].map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => router.push("/invoices/new")}>
          <Receipt className="size-4 mr-1" /> Create Invoice
        </Button>
      </div>

      {loadError ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
            <p role="alert">Could not load invoices: {loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
      ) : invoices.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No invoices found.</CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>Customer</TableHead><TableHead>Posting Date</TableHead>
                  <TableHead>Due Date</TableHead><TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead><TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/invoices/${inv.id}`)}>
                    <TableCell className="text-ct-muted">{inv.invoiceNumber}</TableCell>
                    <TableCell className="font-medium text-ct-navy">{inv.customerName ?? "—"}</TableCell>
                    <TableCell>{formatDate(inv.postingDate)}</TableCell>
                    <TableCell className="text-ct-muted">{inv.dueDate ? formatDate(inv.dueDate) : "—"}</TableCell>
                    <TableCell className="text-right">{money(inv.grandTotal)}</TableCell>
                    <TableCell className="text-right">{money(inv.outstandingAmount)}</TableCell>
                    <TableCell><Badge variant={INVOICE_STATUS_VARIANT[inv.status] ?? "outline"} className="capitalize">{inv.status.replace("_", " ")}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm text-ct-muted">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          Page {page} of {totalPages}
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

function CreditNotesPanel() {
  const router = useRouter();
  const currencies = useCurrencies();
  const money = (v: string | number) => `${currencyLabel(undefined, currencies)}${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const [notes, setNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchOk<{ creditNotes?: CreditNote[] }>("/api/v1/projexa/credit-notes", "credit notes");
      setNotes(data.creditNotes ?? []);
      setLoadError(null);
    } catch (err) {
      setNotes([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load credit notes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => router.push("/invoices/credit-notes/new")}>
          <Plus className="size-4 mr-1" /> New Credit Note
        </Button>
      </div>
      {loadError ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
            <p role="alert">Could not load credit notes: {loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
      ) : notes.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No credit notes yet.</CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>#</TableHead><TableHead>Posting Date</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {notes.map((n) => (
                  <TableRow key={n.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/invoices/credit-notes/${n.id}`)}>
                    <TableCell className="text-ct-muted">{n.creditNoteNumber}</TableCell>
                    <TableCell>{formatDate(n.postingDate)}</TableCell>
                    <TableCell className="text-ct-muted">{n.reason ?? "—"}</TableCell>
                    <TableCell className="text-right">{money(n.totalAmount)}</TableCell>
                    <TableCell><Badge variant={n.status === "submitted" ? "default" : "outline"} className="capitalize">{n.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ArAgingPanel() {
  const currencies = useCurrencies();
  const money = (v: string | number) => `${currencyLabel(undefined, currencies)}${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const [report, setReport] = useState<AgingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await fetchOk<AgingReport>("/api/v1/projexa/ar-aging", "the AR aging report"));
      setLoadError(null);
    } catch (err) {
      setReport(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load the AR aging report");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  if (loadError || !report) {
    return (
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
          <p role="alert">{loadError ?? "Couldn't load the AR aging report."}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  const bucketCards: [string, number][] = [
    ["Current", report.buckets.current], ["1-30d", report.buckets.d1_30], ["31-60d", report.buckets.d31_60],
    ["61-90d", report.buckets.d61_90], ["90+d", report.buckets.d90Plus],
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-sm">
        {bucketCards.map(([label, value]) => (
          <Card key={label} className="rounded-xl shadow-card bg-white">
            <CardContent className="p-3">
              <p className="text-xs text-ct-muted">{label}</p>
              <p className="mt-1 font-semibold text-ct-navy">{money(value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          {report.invoices.length === 0 ? (
            <p className="py-10 text-center text-sm text-ct-muted">No outstanding invoices.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Due Date</TableHead>
                  <TableHead>Days Overdue</TableHead><TableHead>Bucket</TableHead><TableHead className="text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.invoices.map((inv) => (
                  <TableRow key={inv.invoiceId}>
                    <TableCell className="font-medium text-ct-navy">#{inv.invoiceNumber}</TableCell>
                    <TableCell className="text-ct-muted">{inv.customerName ?? "—"}</TableCell>
                    <TableCell className="text-ct-muted">{inv.dueDate ? formatDate(inv.dueDate) : "—"}</TableCell>
                    <TableCell className={inv.daysOverdue > 0 ? "text-red-600" : "text-ct-muted"}>{inv.daysOverdue}d</TableCell>
                    <TableCell><Badge variant="outline">{inv.bucket}</Badge></TableCell>
                    <TableCell className="text-right">{money(inv.outstandingAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InvoicesPageInner() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [activeTab, setActiveTabState] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "invoices");

  function setActiveTab(next: string) {
    setActiveTabState(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Invoices</h1>
        <p className="text-sm text-ct-muted mt-1">Sales invoices, credit notes and receivables aging.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="credit-notes">Credit Notes</TabsTrigger>
          <TabsTrigger value="aging">AR Aging</TabsTrigger>
        </TabsList>
        <TabsContent value="invoices"><InvoicesPanel /></TabsContent>
        <TabsContent value="credit-notes"><CreditNotesPanel /></TabsContent>
        <TabsContent value="aging"><ArAgingPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={<div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-ct-muted" /></div>}>
      <InvoicesPageInner />
    </Suspense>
  );
}
