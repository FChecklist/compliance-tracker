"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge module 21/24 (GRC): port of PROJEXA's own
// AccessReviewCycleObjectClient.tsx
// (src/app/(app)/grc/access-review/[id]/page.tsx there). Confirm/Revoke via
// PATCH /api/v1/projexa/access-review/certifications/[id]
// (reviewCertification in access-review-service.ts) -- a "revoked" decision
// has real teeth: it flips that user's isActive to false, enforced by
// requireAuth(). A reviewer cannot decide their own certification row
// (isSelfApproval check, server-side).
//
// One real contract difference from PROJEXA's own client code, found by
// reading the actual route (not assumed): PROJEXA's own GET
// /api/access-review?cycleId= returns the cycle detail object directly, but
// this repo's GET /api/v1/projexa/access-review?cycleId= wraps it as
// {cycle: detail} (getAccessReviewCycleDetail in access-review-service.ts)
// -- this page reads `data.cycle`, not `data`.
//
// UI is compliance-tracker's own shadcn Card/Table/Badge (house convention),
// not PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Certification = { id: string; userId: string; userName: string; userEmail: string | null; reviewedRole: string; decision: string };
type Cycle = { id: string; name: string; status: string; dueDate: string | null; completedAt: string | null; certifications: Certification[] };

const DECISION_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline", confirmed: "default", revoked: "destructive",
};

export default function AccessReviewCycleDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const cycleId = params.id;

  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/access-review?cycleId=${encodeURIComponent(cycleId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load this access review cycle");
      setCycle((data?.cycle ?? null) as Cycle | null);
      setLoadError(null);
    } catch (err) {
      setCycle(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this access review cycle");
    } finally {
      setLoading(false);
    }
  }, [cycleId]);

  useEffect(() => { void load(); }, [load]);

  async function decide(certificationId: string, decision: "confirmed" | "revoked") {
    setDecidingId(certificationId);
    try {
      const res = await fetch(`/api/v1/projexa/access-review/certifications/${encodeURIComponent(certificationId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to update certification");
      toast.success(`Certification ${decision}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update certification");
    } finally {
      setDecidingId(null);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !cycle) {
    return (
      <div className="space-y-3">
        <Link href="/grc?tab=access-review" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" /> Back to Access Review
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Access review cycle not found."}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  const pendingCount = cycle.certifications.filter((c) => c.decision === "pending").length;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/grc?tab=access-review")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Access Review
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-heading text-ct-navy">{cycle.name}</h1>
          <Badge variant={pendingCount === 0 ? "default" : "outline"} className="capitalize">{cycle.status}</Badge>
        </div>
        <p className="text-sm text-ct-muted mt-1">
          Due: {cycle.dueDate ?? "—"} &middot; Pending: {pendingCount} &middot; Total: {cycle.certifications.length}
        </p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Certifications</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>User</TableHead><TableHead>Role</TableHead><TableHead>Decision</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {cycle.certifications.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-ct-navy">{c.userName}<div className="text-xs text-ct-muted">{c.userEmail}</div></TableCell>
                  <TableCell className="text-ct-muted">{c.reviewedRole}</TableCell>
                  <TableCell><Badge variant={DECISION_VARIANT[c.decision] ?? "outline"} className="capitalize">{c.decision}</Badge></TableCell>
                  <TableCell className="text-right">
                    {c.decision === "pending" && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" disabled={decidingId === c.id} onClick={() => decide(c.id, "confirmed")}>Confirm</Button>
                        <Button size="sm" variant="destructive" disabled={decidingId === c.id} onClick={() => decide(c.id, "revoked")}>Revoke</Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
