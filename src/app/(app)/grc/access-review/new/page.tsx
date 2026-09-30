"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge module 21/24 (GRC): port of PROJEXA's own
// AccessReviewCreateClient.tsx (src/app/(app)/grc/access-review/new/page.tsx
// there). POSTs to the already-live POST /api/v1/projexa/access-review
// (createAccessReviewCycle in access-review-service.ts) -- zero new backend
// route. Requires requireRoleOrScope(ctx, "manager", "write"). Opening a
// cycle snapshots every active org member's current role into a pending
// certification row an admin/manager then confirms or revokes.
//
// UI is compliance-tracker's own shadcn Card/Input (house convention), not
// PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AccessReviewNewPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createCycle() {
    if (!name.trim()) {
      toast.error("Cycle name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/access-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to open cycle");
      toast.success("Access review cycle opened");
      router.push(`/grc/access-review/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open cycle");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Open an Access Review Cycle</h1>
        <p className="text-sm text-ct-muted mt-1">GRC / Access Review / New</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Cycle Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-ct-muted">Snapshots every active team member&apos;s current role into a pending certification you&apos;ll confirm or revoke.</p>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Cycle Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 2026 Access Review" disabled={submitting} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/grc?tab=access-review")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={createCycle}
          disabled={submitting || !name.trim()}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Opening…" : "Open Cycle"}
        </Button>
      </div>
    </div>
  );
}
