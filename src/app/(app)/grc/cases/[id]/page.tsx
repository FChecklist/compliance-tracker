"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge module 21/24 (GRC): port of PROJEXA's own
// FraudCaseObjectClient.tsx (src/app/(app)/grc/cases/[id]/page.tsx there).
// Reads GET /api/v1/projexa/fraud-cases/[id] (getFraudCase in
// fraud-case-service.ts, returns the raw fraudCases row directly --
// unwrapped). Advances status via PATCH .../[id] with the real branching
// status machine (reported -> investigating -> confirmed/unsubstantiated ->
// resolved), including the real resolutionSummary field on the final
// "resolved" transition, enforced server-side by VALID_FRAUD_TRANSITIONS.
//
// UI is compliance-tracker's own shadcn Card/Badge/Textarea (house
// convention), not PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type FraudCase = {
  id: string; caseNumber: number; title: string; status: string; fraudType: string;
  description: string | null; financialExposure: string | null; reportedDate: string;
  resolutionSummary: string | null; resolvedDate: string | null;
};

const TRANSITIONS: Record<string, string[]> = {
  reported: ["investigating"], investigating: ["confirmed", "unsubstantiated"],
  confirmed: ["resolved"], unsubstantiated: ["resolved"], resolved: [],
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  reported: "outline", investigating: "secondary", confirmed: "destructive", unsubstantiated: "outline", resolved: "default",
};

export default function FraudCaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const caseId = params.id;
  const currencies = useCurrencies();

  const [fraudCase, setFraudCase] = useState<FraudCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [resolutionSummary, setResolutionSummary] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/fraud-cases/${encodeURIComponent(caseId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load this case");
      setFraudCase(data as FraudCase);
      setLoadError(null);
    } catch (err) {
      setFraudCase(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this case");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  async function transition(status: string) {
    setTransitioning(status);
    try {
      const res = await fetch(`/api/v1/projexa/fraud-cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolutionSummary: status === "resolved" ? (resolutionSummary || undefined) : undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to update case status");
      toast.success(`Case moved to ${status}`);
      setResolutionSummary("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update case status");
    } finally {
      setTransitioning(null);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !fraudCase) {
    return (
      <div className="space-y-3">
        <Link href="/grc?tab=fraud" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" /> Back to Fraud &amp; Incidents
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Case not found."}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  const nextOptions = TRANSITIONS[fraudCase.status] ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/grc?tab=fraud")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Fraud &amp; Incidents
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-heading text-ct-navy">Case #{fraudCase.caseNumber} — {fraudCase.title}</h1>
          <Badge variant={STATUS_VARIANT[fraudCase.status] ?? "outline"} className="capitalize">{fraudCase.status.replace(/_/g, " ")}</Badge>
        </div>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Case Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div><p className="text-xs font-medium text-ct-muted uppercase">Type</p><p className="mt-1 capitalize text-ct-navy">{fraudCase.fraudType.replace(/_/g, " ")}</p></div>
            <div><p className="text-xs font-medium text-ct-muted uppercase">Reported</p><p className="mt-1 text-ct-navy">{fraudCase.reportedDate}</p></div>
            <div><p className="text-xs font-medium text-ct-muted uppercase">Financial Exposure</p><p className="mt-1 text-ct-navy">{fraudCase.financialExposure ? `${currencyLabel(undefined, currencies)}${Number(fraudCase.financialExposure).toLocaleString("en-IN")}` : "—"}</p></div>
          </div>
          <p className="text-sm text-ct-navy whitespace-pre-wrap">{fraudCase.description || <span className="text-ct-muted">No description.</span>}</p>

          {nextOptions.length > 0 && (
            <div className="space-y-2 border-t border-ct-border pt-3">
              {nextOptions.includes("resolved") && (
                <div className="space-y-1.5 max-w-md">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Resolution Summary (optional)</Label>
                  <Textarea value={resolutionSummary} onChange={(e) => setResolutionSummary(e.target.value)} rows={2} />
                </div>
              )}
              <div className="flex gap-2">
                {nextOptions.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    disabled={transitioning !== null}
                    onClick={() => transition(s)}
                    className={s === "resolved" ? "bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" : undefined}
                    variant={s === "resolved" ? "default" : "outline"}
                  >
                    {transitioning === s ? "Updating…" : `Move to ${s.replace(/_/g, " ")}`}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {fraudCase.status === "resolved" && (
            <div className="border-t border-ct-border pt-3">
              <p className="mb-1 text-xs font-semibold text-ct-muted uppercase">Resolution</p>
              <p className="text-sm text-ct-navy">{fraudCase.resolutionSummary ?? "—"}</p>
              <p className="text-xs text-ct-muted">Resolved {fraudCase.resolvedDate}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
