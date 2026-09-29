"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own CustomerCreateClient.tsx. Same 3 fields PROJEXA's create
// form collects (customerName/gstin/creditLimit -- PAN is edit-only there,
// not part of create, so it's left out here too for a faithful port).
// POSTs to the same POST /api/v1/projexa/customers this app's backend
// already serves.
//
// Rebuilt on this repo's own Card/Label/Input, not PROJEXA's forked
// ObjectScreen (@/components/screens/KitObjectScreen) -- see
// src/app/(app)/customers/page.tsx's header comment for the house
// convention this follows.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CustomerNewPage() {
  const router = useRouter();
  const [customerName, setCustomerName] = useState("");
  const [gstin, setGstin] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const create = async () => {
    if (!customerName.trim()) { toast.error("Customer name is required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: customerName.trim(),
          gstin: gstin || undefined,
          creditLimit: creditLimit ? Number(creditLimit) : undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't add customer");
      toast.success("Customer added");
      router.push(`/customers/${body.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add customer");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Customer</h1>
        <p className="text-sm text-ct-muted mt-1">Customers / New Customer</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Customer details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Customer Name</Label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">GSTIN (optional)</Label>
            <Input value={gstin} onChange={(e) => setGstin(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Credit Limit (optional)</Label>
            <Input type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} placeholder="No limit" />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/customers")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
          onClick={create}
          disabled={submitting || !customerName.trim()}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}
