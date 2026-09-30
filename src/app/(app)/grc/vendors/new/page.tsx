"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge module 21/24 (GRC): port of PROJEXA's own
// VendorRiskCreateClient.tsx (src/app/(app)/grc/vendors/new/page.tsx
// there). POSTs to the already-live POST /api/v1/projexa/vendor-risk
// (createVendorRiskProfile in risk-register-service.ts) -- zero new backend
// route. Requires requireRoleOrScope(ctx, "manager", "write"). No Object
// Page yet: no get/update-single exists for vendor-risk profiles, and
// there's an unresolved naming overlap with the separate
// /api/v1/projexa/vendors master-vendor CRUD surface (unused by this panel
// today) -- which backing entity a real Object Page should represent is a
// design decision, not a route-file afterthought, matching PROJEXA's own
// honest scope cut verbatim.
//
// UI is compliance-tracker's own shadcn Card/Input/Select (house convention).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const RISK_TIERS = ["low", "medium", "high"];

export default function VendorRiskNewPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [riskTier, setRiskTier] = useState("low");
  const [submitting, setSubmitting] = useState(false);

  async function createProfile() {
    if (!name.trim()) {
      toast.error("Vendor name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/vendor-risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), riskTier }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to add vendor");
      toast.success("Vendor added for risk tracking");
      router.push("/grc?tab=vendor-risk");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add vendor");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Add Vendor for Risk Tracking</h1>
        <p className="text-sm text-ct-muted mt-1">GRC / Vendor Risk / New</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Vendor Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Vendor Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Risk Tier</Label>
            <Select value={riskTier} onValueChange={setRiskTier} disabled={submitting}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{RISK_TIERS.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/grc?tab=vendor-risk")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={createProfile}
          disabled={submitting || !name.trim()}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Adding…" : "Add Vendor"}
        </Button>
      </div>
    </div>
  );
}
