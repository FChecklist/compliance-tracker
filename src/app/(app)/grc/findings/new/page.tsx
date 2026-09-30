"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge module 21/24 (GRC): port of PROJEXA's own
// AuditFindingCreateClient.tsx (src/app/(app)/grc/findings/new/page.tsx
// there). POSTs to the already-live POST /api/v1/projexa/audit-findings
// (createAuditFinding in risk-register-service.ts) -- zero new backend
// route. Requires requireRoleOrScope(ctx, "manager", "write"). No Object
// Page for a finding: findings are only ever read pre-nested inside an
// engagement (GET /api/v1/projexa/audit-engagements), no standalone GET --
// the same honest scope cut PROJEXA's own source carries.
//
// UI is compliance-tracker's own shadcn Card/Input/Select (house
// convention); the sole-option preselect uses this repo's own
// soleOptionId() (src/lib/reference-lookups.ts), same helper PROJEXA's
// upstream source used.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { soleOptionId } from "@/lib/reference-lookups";

type Engagement = { id: string; name: string };
const SEVERITIES = ["low", "medium", "high", "critical"];

export default function AuditFindingNewPage() {
  const router = useRouter();
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [engagementId, setEngagementId] = useState("");
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/audit-engagements")
      .then((r) => r.json())
      .then((d) => {
        const rows: Engagement[] = d.engagements ?? [];
        setEngagements(rows);
        // An org running a single audit engagement is the normal case, and
        // every finding recorded during it belongs to it. Preselected
        // rather than asked for; still a plain select, still changeable.
        const sole = soleOptionId(rows);
        if (sole) setEngagementId((prev) => prev || sole);
      })
      .catch(() => {});
  }, []);

  async function createFinding() {
    if (!engagementId || !title.trim()) {
      toast.error("Audit engagement and title are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/audit-findings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditEngagementId: engagementId, title: title.trim(), severity }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to record finding");
      toast.success("Finding recorded");
      router.push("/grc?tab=audits");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record finding");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Record a Finding</h1>
        <p className="text-sm text-ct-muted mt-1">GRC / Audits &amp; Findings / New Finding</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Finding Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Audit Engagement</Label>
            <Select value={engagementId} onValueChange={setEngagementId} disabled={submitting || engagements.length === 0}>
              <SelectTrigger><SelectValue placeholder={engagements.length ? "Select an engagement" : "Plan an engagement first"} /></SelectTrigger>
              <SelectContent>{engagements.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Finding Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Missing fire-exit signage on Floor 3" disabled={submitting} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Severity</Label>
            <Select value={severity} onValueChange={setSeverity} disabled={submitting}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/grc?tab=audits")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={createFinding}
          disabled={submitting || !engagementId || !title.trim()}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Recording…" : "Record Finding"}
        </Button>
      </div>
    </div>
  );
}
