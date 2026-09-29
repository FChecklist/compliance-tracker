"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge, batch 2 (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own VendorCreateClient.tsx (src/app/(app)/vendors/new/page.tsx
// there), which itself replaced VendorsClient.tsx's old "New Vendor" Dialog
// popup with a real create route (PROJEXA's 2026-08-30 "real-screen
// conversion"). POSTs to the already-native /api/v1/projexa/vendors -- see
// ../page.tsx's own header comment for the backend mapping.
//
// UI is compliance-tracker's own shadcn Card/Input/Label form (matching
// src/app/(app)/vendors/page.tsx's own Card conventions), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen. isIndiaOrg gating on GST/PAN
// (PROJEXA's own useOrgRole()) is likewise not ported -- see ../page.tsx's
// header comment for why; both fields render unconditionally here.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function NewVendorPage() {
  const router = useRouter();
  const [vendorName, setVendorName] = useState("");
  const [vendorType, setVendorType] = useState("");
  const [trade, setTrade] = useState("");
  const [gst, setGst] = useState("");
  const [pan, setPan] = useState("");
  const [defaultPaymentTermsDays, setDefaultPaymentTermsDays] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const create = async () => {
    if (!vendorName.trim()) { toast.error("Vendor name is required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorName: vendorName.trim(), vendorType: vendorType || undefined, trade: trade || undefined,
          gst: gst || undefined, pan: pan || undefined,
          defaultPaymentTermsDays: defaultPaymentTermsDays ? Number(defaultPaymentTermsDays) : undefined,
          creditLimit: creditLimit ? Number(creditLimit) : undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't add vendor");
      toast.success("Vendor added");
      router.push(`/vendors/${body.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add vendor");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Vendor</h1>
        <p className="text-sm text-ct-muted mt-1">Vendors / New Vendor</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white max-w-2xl">
        <CardHeader><CardTitle className="text-base text-ct-navy">Vendor details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Vendor Name</Label>
            <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Type (optional)</Label>
              <Input value={vendorType} onChange={(e) => setVendorType(e.target.value)} placeholder="e.g. Subcontractor" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Trade (optional)</Label>
              <Input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="e.g. Electrical" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">GST (optional)</Label>
              <Input value={gst} onChange={(e) => setGst(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">PAN (optional)</Label>
              <Input value={pan} onChange={(e) => setPan(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Payment Terms, days (optional)</Label>
              <Input type="number" value={defaultPaymentTermsDays} onChange={(e) => setDefaultPaymentTermsDays(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Credit Limit (optional)</Label>
              <Input type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => router.push("/vendors")}>Cancel</Button>
            <Button
              onClick={() => void create()}
              disabled={submitting || !vendorName.trim()}
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
            >
              {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Save Vendor
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
