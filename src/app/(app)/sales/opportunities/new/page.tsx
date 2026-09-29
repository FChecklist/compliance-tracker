"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own OpportunityCreateClient.tsx -- name + customer (both
// required, matching PROJEXA's own validation) plus optional estimated
// value and expected close date. POSTs to the SAME
// POST /api/v1/projexa/opportunities this app's backend already serves
// (createOpportunity in crm-service.ts) -- zero new backend route.
//
// Real API contract check (crm-service.ts's createOpportunity, read before
// writing this file): an opportunity needs a leadId, a clientId, OR an
// erpCustomerId -- PROJEXA's own UI only ever supplies erpCustomerId (no
// "convert this lead" entry point into this form), so this port keeps that
// same single path rather than inventing a lead-to-opportunity picker
// PROJEXA itself never built.
//
// Rebuilt on this repo's own Card/Input/Select/Label (matching
// src/app/(app)/sales-orders/new/page.tsx), not PROJEXA's own
// @fchecklist/veridian-ui-kit ObjectScreen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Customer = { id: string; customerName: string };

export default function OpportunityNewPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [erpCustomerId, setErpCustomerId] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/customers").then((r) => r.json()).then((d) => setCustomers(d.customers ?? [])).catch(() => {});
  }, []);

  const missing = [
    ...(name.trim() ? [] : ["Name"]),
    ...(erpCustomerId ? [] : ["Customer"]),
  ];

  async function create() {
    if (missing.length) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/opportunities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), erpCustomerId,
          estimatedValue: estimatedValue ? Number(estimatedValue) : undefined,
          expectedCloseDate: expectedCloseDate || undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't create opportunity");
      toast.success("Opportunity created");
      router.push(`/sales/opportunities/${body.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create opportunity");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl p-6">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Opportunity</h1>
        <p className="text-sm text-ct-muted mt-1">Sales / Opportunities / New Opportunity</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Opportunity Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Customer</Label>
            <Select value={erpCustomerId} onValueChange={setErpCustomerId}>
              <SelectTrigger><SelectValue placeholder="Select a customer" /></SelectTrigger>
              <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Estimated Value (optional)</Label>
              <Input type="number" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Expected Close (optional)</Label>
              <Input type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/sales/opportunities")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={create}
          disabled={submitting || missing.length > 0}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Creating..." : "Create Opportunity"}
        </Button>
      </div>
    </div>
  );
}
