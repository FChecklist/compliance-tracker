"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge module 21/24 (GRC): port of PROJEXA's own
// AuditEngagementCreateClient.tsx (src/app/(app)/grc/audits/new/page.tsx
// there). POSTs to the already-live POST /api/v1/projexa/audit-engagements
// (createAuditEngagement in risk-register-service.ts) -- zero new backend
// route. Requires requireRoleOrScope(ctx, "manager", "write"). No Object
// Page for an engagement: no getAuditEngagement()/updateAuditEngagement()
// exists server-side (only list-with-nested-findings + create) -- the same
// honest scope cut PROJEXA's own source carries.
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

const TYPES = ["internal", "certification", "statutory"];

export default function AuditEngagementNewPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [auditType, setAuditType] = useState("internal");
  const [submitting, setSubmitting] = useState(false);

  async function createEngagement() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/audit-engagements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), auditType }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to plan audit engagement");
      toast.success("Audit engagement planned");
      router.push("/grc?tab=audits");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't plan audit engagement");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Plan an Audit Engagement</h1>
        <p className="text-sm text-ct-muted mt-1">GRC / Audits &amp; Findings / New</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Engagement Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 Site Safety Audit" disabled={submitting} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Type</Label>
            <Select value={auditType} onValueChange={setAuditType} disabled={submitting}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/grc?tab=audits")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={createEngagement}
          disabled={submitting || !name.trim()}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Planning…" : "Plan Audit"}
        </Button>
      </div>
    </div>
  );
}
