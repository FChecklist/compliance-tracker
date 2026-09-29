"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own Customers list (src/app/(app)/customers/page.tsx +
// CustomersClient.tsx there). Reads the SAME /api/v1/projexa/customers this
// app's backend already serves (Priority 13/15) -- same paginated/searchable
// response shape (listCustomersPaged), zero new backend route, zero HTTP hop
// to a separate origin.
//
// UI is compliance-tracker's own shadcn Table/Card (matching the house
// convention every already-ported PROJEXA page uses -- see
// src/app/(app)/projects/page.tsx, src/app/(app)/permits/page.tsx), not
// PROJEXA's @fchecklist/veridian-ui-kit ScreenFrame/ListScreen. Porting the
// DATA and BEHAVIOUR, not the exact component tree.
//
// GSTIN is shown unconditionally here (no isIndiaOrg gate) -- PROJEXA's own
// CustomersClient.tsx hides it for non-India orgs via useOrgRole()'s
// isIndiaOrg (backed by PROJEXA's own GET /api/organization), but that hook
// and its backing route have no equivalent in this repo yet. The existing
// native /erp/customers page (src/app/(app)/erp/customers/page.tsx, same
// erp_customers table) already shows GSTIN unconditionally with no country
// gate, so this matches this repo's own established convention rather than
// inventing a new hook/route as part of a UI-only port.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Customer = {
  id: string;
  customerName: string;
  gstin: string | null;
  defaultPaymentTermsDays: number | null;
  creditLimit: string | null;
  isActive: boolean;
};

export default function CustomersPage() {
  const router = useRouter();
  const currencies = useCurrencies();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/v1/projexa/customers?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCustomers([]);
        setLoadError(body.error ?? `Couldn't load customers (HTTP ${res.status})`);
        return;
      }
      setCustomers(body.customers ?? []);
      setTotal(body.total ?? body.customers?.length ?? 0);
      setLoadError(null);
    } catch (err) {
      setCustomers([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load customers");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { void load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const money = (n: string | null) =>
    n === null ? "—" : `${currencyLabel(undefined, currencies)}${Number(n).toLocaleString("en-IN")}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Customers</h1>
          <p className="text-sm text-ct-muted mt-1">Every customer sold to -- credit limits, GSTIN, and a 360&deg; view of opportunities, quotations, orders and invoices.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search customers..."
            value={search}
            onChange={(e) => { setPage(1); setSearch(e.target.value); }}
            className="w-56"
          />
          <Button
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
            onClick={() => router.push("/customers/new")}
          >
            <Plus className="size-4 mr-1" /> New Customer
          </Button>
        </div>
      </div>

      {loadError ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">Could not load customers: {loadError}</CardContent></Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
            ) : customers.length === 0 ? (
              <p className="py-10 text-center text-sm text-ct-muted">No customers found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>GSTIN</TableHead>
                    <TableHead>Credit Limit</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium text-ct-navy">
                        <Link href={`/customers/${c.id}`} className="hover:underline">{c.customerName}</Link>
                      </TableCell>
                      <TableCell className="text-ct-muted">{c.gstin ?? "—"}</TableCell>
                      <TableCell className="text-ct-muted">{money(c.creditLimit)}</TableCell>
                      <TableCell><Badge variant={c.isActive ? "default" : "outline"}>{c.isActive ? "active" : "inactive"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {!loadError && total > pageSize && (
        <div className="flex items-center justify-between text-sm text-ct-muted">
          <span>Page {page} of {totalPages} -- {total} customer(s)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
