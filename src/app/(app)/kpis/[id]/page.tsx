"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge: port of PROJEXA's own KpiObjectClient.tsx
// (src/app/(app)/kpis/[id]/page.tsx there) -- KPI definition detail, actual
// value submission and approval. Reads/writes the SAME
// /api/v1/construction/kpi-entries and .../kpi-entries/[id]/approve routes
// PROJEXA's own /api/kpi-entries proxy calls with root:true (never
// re-exported under /projexa/*, per that proxy's own comment) -- zero new
// backend route. UI rebuilt on compliance-tracker's own shadcn
// Card/Table/Badge (house convention), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen.
//
// approveKpiEntry()'s self-approval check ("The submitter cannot approve
// their own KPI entry") is a real backend business rule, not a bug --
// surfaced verbatim via toast, never swallowed (see
// construction-kpi-service.ts's own comment on approveKpiEntry).
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type KpiDefinition = { id: string; projectId: string | null; metricName: string; targetValue: string | null; unit: string | null; period: string };
type KpiEntry = { id: string; period: string; actualValue: string; approvalStatus: string; filledById: string; createdAt: string };

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  submitted: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
};

export default function KpiObjectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const definitionId = params.id;

  const [definition, setDefinition] = useState<KpiDefinition | null>(null);
  const [entries, setEntries] = useState<KpiEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [entryPeriod, setEntryPeriod] = useState("");
  const [actualValue, setActualValue] = useState("");
  const [entrySubmitting, setEntrySubmitting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [defRes, entriesRes] = await Promise.all([
        fetch(`/api/v1/construction/kpi-definitions/${encodeURIComponent(definitionId)}`),
        fetch(`/api/v1/construction/kpi-entries?kpiDefinitionId=${encodeURIComponent(definitionId)}`),
      ]);
      const defData = await defRes.json().catch(() => null);
      if (!defRes.ok) throw new Error(defData?.error ?? "Couldn't load this KPI");
      const entriesData = await entriesRes.json().catch(() => null);
      if (!entriesRes.ok) throw new Error(entriesData?.error ?? "Couldn't load KPI entries");

      setDefinition(defData);
      setEntries(entriesData?.entries ?? []);
      setLoadError(null);
    } catch (err) {
      setDefinition(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this KPI");
    } finally {
      setLoading(false);
    }
  }, [definitionId]);

  useEffect(() => { load(); }, [load]);

  const submitEntry = async () => {
    if (!entryPeriod.trim() || actualValue === "") {
      toast.error("Period and actual value are required");
      return;
    }
    setEntrySubmitting(true);
    try {
      const res = await fetch("/api/v1/construction/kpi-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kpiDefinitionId: definitionId, period: entryPeriod, actualValue: Number(actualValue) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to submit entry");
      toast.success("Actual value submitted");
      setEntryPeriod(""); setActualValue("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit entry");
    } finally {
      setEntrySubmitting(false);
    }
  };

  const approveEntry = async (entryId: string) => {
    setApprovingId(entryId);
    try {
      const res = await fetch(`/api/v1/construction/kpi-entries/${encodeURIComponent(entryId)}/approve`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to approve entry");
      toast.success("Entry approved");
      await load();
    } catch (err) {
      // Real backend validation (e.g. "The submitter cannot approve their
      // own KPI entry") surfaces verbatim -- never swallowed.
      toast.error(err instanceof Error ? err.message : "Couldn't approve entry");
    } finally {
      setApprovingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (loadError || !definition) {
    return (
      <div className="space-y-3">
        <Link href="/kpis" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" />
          Back to KPIs
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "KPI not found."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  const backHref = definition.projectId ? `/kpis?projectId=${definition.projectId}` : "/kpis";

  return (
    <div className="space-y-6">
      <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
        <ArrowLeft className="size-4" />
        Back to KPIs
      </Link>

      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2">
          <Target className="size-6 text-ct-saffron-text" />
          {definition.metricName}
        </h1>
        <p className="text-sm text-ct-muted mt-1">
          Target: {definition.targetValue ? `${definition.targetValue}${definition.unit ? ` ${definition.unit}` : ""}` : "--"} &middot; Period: {definition.period}
        </p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Submit Actual Value</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Period</Label>
              <Input value={entryPeriod} onChange={(e) => setEntryPeriod(e.target.value)} placeholder="e.g. 2026-07" className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Actual Value</Label>
              <Input type="number" value={actualValue} onChange={(e) => setActualValue(e.target.value)} className="w-32" />
            </div>
            <Button
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
              disabled={entrySubmitting}
              onClick={submitEntry}
            >
              {entrySubmitting ? "Submitting..." : "Submit Actual Value"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Entries</CardTitle></CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-ct-muted">No actual values submitted yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Period</TableHead><TableHead>Actual</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.period}</TableCell>
                    <TableCell>{e.actualValue}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-[10px] ${STATUS_BADGE[e.approvalStatus] ?? ""}`}>
                        {e.approvalStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {e.approvalStatus === "submitted" && (
                        <Button size="sm" variant="outline" disabled={approvingId === e.id} onClick={() => approveEntry(e.id)}>
                          {approvingId === e.id ? "Approving..." : "Approve"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
