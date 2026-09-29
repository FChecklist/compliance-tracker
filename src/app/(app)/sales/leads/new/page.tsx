"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own LeadCreateClient.tsx -- name (required), email/phone/source
// (optional), and next follow-up date. POSTs to the SAME
// POST /api/v1/projexa/leads this app's backend already serves (createLead
// in crm-service.ts) -- zero new backend route.
//
// Scope decision: PROJEXA's own optional Company/Office picker
// (CompanySelector) is NOT ported here -- see the sibling leads/page.tsx
// header comment for why (no other leads-adjacent already-merged module
// took on that dependency).
//
// Rebuilt on this repo's own Card/Input/Label (matching
// src/app/(app)/sales-orders/new/page.tsx), not PROJEXA's own
// @fchecklist/veridian-ui-kit ObjectScreen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LeadNewPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [source, setSource] = useState("");
  const [nextActionDate, setNextActionDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function create() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/leads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          contactEmail: contactEmail.trim() || undefined,
          contactPhone: contactPhone.trim() || undefined,
          source: source.trim() || undefined,
          nextActionDate: nextActionDate || undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't create lead");
      toast.success("Lead created");
      router.push(`/sales/leads/${body.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create lead");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl p-6">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Lead</h1>
        <p className="text-sm text-ct-muted mt-1">Sales / Leads / New Lead</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Lead Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Email (optional)</Label>
              <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Phone (optional)</Label>
              <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Source (optional)</Label>
              <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. referral, website" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Next Follow-up (optional)</Label>
              <Input type="date" value={nextActionDate} onChange={(e) => setNextActionDate(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/sales/leads")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={create}
          disabled={submitting || !name.trim()}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Creating..." : "Create Lead"}
        </Button>
      </div>
    </div>
  );
}
