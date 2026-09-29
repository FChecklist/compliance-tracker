"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge, batch 2 (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own Vendors list (src/app/(app)/vendors/page.tsx +
// VendorsClient.tsx there). Reads the already-native
// /api/v1/projexa/vendors -- a thin alias over erp-buying-service.ts's
// listSuppliers()/createSupplier(), reshaping supplierName/supplierType/
// gstin into vendorName/vendorType/gst for construction-domain language (see
// that route's own header comment) -- zero new backend route, zero HTTP hop
// to a separate origin.
//
// UI is compliance-tracker's own shadcn Table/Card (matching the house
// convention every already-ported construction-* / PROJEXA-merge page
// uses: src/app/(app)/projects/page.tsx, src/app/(app)/permits/page.tsx),
// not PROJEXA's @fchecklist/veridian-ui-kit ScreenFrame/ListScreen -- and a
// real "New Vendor" route (src/app/(app)/vendors/new/page.tsx) rather than a
// Dialog popup, matching PROJEXA's own 2026-08-30 "real-screen conversion"
// of this exact module (its VendorsClient.tsx's own header comment).
//
// PROJEXA's isIndiaOrg gate (useOrgRole()) on the GST column has NO
// compliance-tracker equivalent yet -- no useOrgRole hook, no org-country
// concept, exists anywhere in this repo as of this port (confirmed via a
// repo-wide search before writing this file). Rather than invent new
// org-country infrastructure for a UI-only port, GST renders unconditionally
// here; revisit once/if this repo grows its own org-country concept.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Vendor = {
  id: string; vendorName: string; vendorType: string | null; gst: string | null;
  trade: string | null; isActive: boolean;
};

export default function VendorsPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/projexa/vendors");
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setVendors([]);
        setLoadError(body?.error ?? `Couldn't load vendors (HTTP ${res.status})`);
        return;
      }
      setVendors(body.vendors ?? []);
      setLoadError(null);
    } catch (err) {
      setVendors([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load vendors");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Vendors</h1>
          <p className="text-sm text-ct-muted mt-1">Suppliers and subcontractors -- qualification, sanction screening, banking details and self-service portal links live on each vendor&apos;s own page.</p>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => router.push("/vendors/new")}>
          <Plus className="size-4 mr-1" /> New Vendor
        </Button>
      </div>

      {loadError ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
            <p role="alert">Could not load vendors: {loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
      ) : vendors.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No vendors added yet.</CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Trade</TableHead>
                  <TableHead>GST</TableHead><TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((v) => (
                  <TableRow key={v.id} className="cursor-pointer" onClick={() => router.push(`/vendors/${v.id}`)}>
                    <TableCell className="font-medium text-ct-navy">{v.vendorName}</TableCell>
                    <TableCell className="text-ct-muted-text">{v.vendorType ?? "--"}</TableCell>
                    <TableCell className="text-ct-muted-text">{v.trade ?? "--"}</TableCell>
                    <TableCell className="text-ct-muted-text">{v.gst ?? "--"}</TableCell>
                    <TableCell><Badge variant={v.isActive ? "default" : "outline"}>{v.isActive ? "active" : "inactive"}</Badge></TableCell>
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
