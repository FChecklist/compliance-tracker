"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge: port of PROJEXA's own KpiCreateClient.tsx
// (src/app/(app)/kpis/new/page.tsx there), rebuilt on compliance-tracker's
// own shadcn Card/Input/Select instead of PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen -- same house convention as
// src/app/(app)/departments/new/page.tsx.
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function NewKpiForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") ?? "";

  const [metricName, setMetricName] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [unit, setUnit] = useState("");
  const [period, setPeriod] = useState("monthly");
  const [submitting, setSubmitting] = useState(false);

  const backHref = projectId ? `/kpis?projectId=${projectId}` : "/kpis";

  const createDefinition = async () => {
    if (!metricName.trim()) {
      toast.error("Metric name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/construction/kpi-definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, metricName: metricName.trim(),
          targetValue: targetValue ? Number(targetValue) : undefined,
          unit: unit || undefined, period,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't create KPI");
      toast.success("KPI created");
      router.push(`/kpis/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create KPI");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
        <ArrowLeft className="size-4" />
        Back to KPIs
      </Link>

      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">New KPI Definition</h1>
        <p className="text-sm text-ct-muted mt-1">Define a metric to track against target for this project.</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">KPI Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Metric Name</Label>
            <Input value={metricName} onChange={(e) => setMetricName(e.target.value)} placeholder="e.g. Schedule Variance" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Target Value (optional)</Label>
              <Input type="number" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Unit (optional)</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%, days, Rs." />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Period</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="milestone">Milestone</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button
          type="button"
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          disabled={submitting || !metricName.trim()}
          onClick={createDefinition}
        >
          {submitting ? "Creating..." : "Create KPI"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(backHref)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function KpiNewPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ct-muted">Loading...</p>}>
      <NewKpiForm />
    </Suspense>
  );
}
