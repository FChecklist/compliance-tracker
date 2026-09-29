"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own Quotations module (src/app/(app)/quotations/page.tsx +
// QuotationsClient.tsx there). Reads the already-native
// /api/v1/projexa/quotations (+ [id], [id]/revisions, [id]/pdf,
// [id]/convert) -- zero new backend route, zero HTTP hop to a separate
// origin (verified field-for-field against each route.ts and
// erp-selling-service.ts before writing this file).
//
// Distinct from the SEPARATE /api/v1/projexa/procurement/quotations
// resource (vendor RFQ quotations, erp_supplier_quotations) -- not touched
// here, same as PROJEXA's own comment distinguishing "Sales Quotations"
// from "Procurement's Supplier Quotations".
//
// UI is compliance-tracker's own shadcn Card/Table/Select (matching the
// house convention every already-ported PROJEXA-merge page uses: see
// src/app/(app)/invoices/page.tsx), not PROJEXA's own
// @fchecklist/veridian-ui-kit ObjectScreen/CompanySelector.
//
// Scope decision: PROJEXA's optional multi-company/office filter
// (CompanySelector, Priority 17 final gap) is ported as a plain Select
// sourced from the real GET /api/v1/projexa/companies -- it only renders
// when the org actually has company rows, matching PROJEXA's own
// `companies.length > 0` gating, so an org with no companies set up sees no
// change at all.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Quotation = {
  id: string; quotationNumber: number; customerId: string | null; customerName: string | null;
  quotationDate: string; validTill: string | null; status: string; version: number; revisionOf: string | null;
  companyId: string | null; currencyId: string | null; exchangeRate: string; grandTotal: string;
};
type Company = { id: string; companyName: string; abbr: string | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", pending_approval: "secondary", approved: "secondary", sent: "default", ordered: "default", lost: "destructive", expired: "destructive",
};
const STATUS_OPTIONS = ["draft", "pending_approval", "approved", "sent", "ordered", "lost", "expired"];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

async function fetchOk<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Couldn't load ${what} (HTTP ${res.status})`);
  return body as T;
}

export default function QuotationsPage() {
  const router = useRouter();
  const currencies = useCurrencies();

  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyFilter, setCompanyFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (companyFilter !== "all") params.set("companyId", companyFilter);
      const data = await fetchOk<{ quotations?: Quotation[]; total?: number }>(
        `/api/v1/projexa/quotations?${params.toString()}`, "quotations"
      );
      setQuotations(data.quotations ?? []);
      setTotal(data.total ?? 0);
      setLoadError(null);
    } catch (err) {
      setQuotations([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load quotations");
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, companyFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    fetch("/api/v1/projexa/companies").then((r) => r.json()).then((d) => setCompanies(d.companies ?? [])).catch(() => {});
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Quotations</h1>
        <p className="text-sm text-ct-muted mt-1">Sales quotations to customers -- draft through approval, sending and conversion to a sales order.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search by customer…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} className="w-56" />
          <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          {companies.length > 0 && (
            <Select value={companyFilter} onValueChange={(v) => { setPage(1); setCompanyFilter(v); }}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Company" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => router.push("/quotations/new")}>
          <Plus className="size-4 mr-1" /> New Quotation
        </Button>
      </div>

      {loadError ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
            <p role="alert">Could not load quotations: {loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
      ) : quotations.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No quotations found.</CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>Customer</TableHead><TableHead>Date</TableHead>
                  <TableHead>Version</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotations.map((q) => (
                  <TableRow key={q.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/quotations/${q.id}`)}>
                    <TableCell className="font-medium text-ct-navy">{q.quotationNumber}</TableCell>
                    <TableCell className="text-ct-muted">{q.customerName ?? "—"}</TableCell>
                    <TableCell className="text-ct-muted">{formatDate(q.quotationDate)}</TableCell>
                    <TableCell className="text-ct-muted">v{q.version}{q.revisionOf ? " (revision)" : ""}</TableCell>
                    <TableCell className="text-right">{currencyLabel(q.currencyId, currencies)}{Number(q.grandTotal).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[q.status] ?? "outline"} className="capitalize">{q.status.replace("_", " ")}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {total > pageSize && (
        <div className="flex items-center justify-center gap-3 text-sm text-ct-muted">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          Page {page} of {totalPages} — {total} quotation(s)
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
