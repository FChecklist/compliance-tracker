"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge module 21/24 (GRC): port of PROJEXA's own
// RiskObjectClient.tsx (src/app/(app)/grc/risks/[id]/page.tsx there). Reads
// GET /api/v1/projexa/risks/[id] (getRisk in risk-register-service.ts,
// returns the risk object directly -- unwrapped), advances status via
// PATCH .../[id] ({status}). No Edit: no updateRisk() for title/category/
// likelihood/impact exists server-side, only status and linked-controls (a
// separate, more advanced feature not wired to any UI yet) -- matching
// PROJEXA's own honest scope cut verbatim.
//
// UI is compliance-tracker's own shadcn Card/Badge/Button (house convention),
// not PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Risk = {
  id: string; title: string; category: string; likelihood: number; impact: number;
  severity: string; status: string; ownerId: string | null; ownerDept: string | null;
};

const RISK_STATUS_FLOW: Record<string, string> = { open: "mitigating", mitigating: "closed" };
const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = { low: "outline", medium: "secondary", high: "destructive" };

export default function RiskDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const riskId = params.id;

  const [risk, setRisk] = useState<Risk | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/risks/${encodeURIComponent(riskId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load this risk");
      setRisk(data as Risk);
      setLoadError(null);
    } catch (err) {
      setRisk(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this risk");
    } finally {
      setLoading(false);
    }
  }, [riskId]);

  useEffect(() => { void load(); }, [load]);

  async function advanceStatus() {
    if (!risk) return;
    const next = RISK_STATUS_FLOW[risk.status];
    if (!next) return;
    setAdvancing(true);
    try {
      const res = await fetch(`/api/v1/projexa/risks/${encodeURIComponent(riskId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to update risk status");
      toast.success(`Moved to ${next}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update risk status");
    } finally {
      setAdvancing(false);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !risk) {
    return (
      <div className="space-y-3">
        <Link href="/grc?tab=risks" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" /> Back to Risk Register
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Risk not found."}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  const next = RISK_STATUS_FLOW[risk.status];

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/grc?tab=risks")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Risk Register
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">{risk.title}</h1>
            <Badge variant={SEVERITY_VARIANT[risk.severity] ?? "outline"} className="capitalize">{risk.severity} severity</Badge>
          </div>
          {next && (
            <Button size="sm" disabled={advancing} onClick={advanceStatus} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              {advancing ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              {advancing ? "Updating…" : `Move to ${next}`}
            </Button>
          )}
        </div>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Risk Details</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div><p className="text-xs font-medium text-ct-muted uppercase">Category</p><p className="mt-1 capitalize text-ct-navy">{risk.category}</p></div>
            <div><p className="text-xs font-medium text-ct-muted uppercase">Likelihood</p><p className="mt-1 text-ct-navy">{risk.likelihood} / 5</p></div>
            <div><p className="text-xs font-medium text-ct-muted uppercase">Impact</p><p className="mt-1 text-ct-navy">{risk.impact} / 5</p></div>
            <div><p className="text-xs font-medium text-ct-muted uppercase">Status</p><p className="mt-1 capitalize text-ct-navy">{risk.status}</p></div>
          </div>
          <p className="text-ct-muted">Owner department: {risk.ownerDept ?? "Unassigned"}</p>
        </CardContent>
      </Card>
    </div>
  );
}
