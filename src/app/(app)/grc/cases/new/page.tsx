"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge module 21/24 (GRC): port of PROJEXA's own
// FraudCaseCreateClient.tsx (src/app/(app)/grc/cases/new/page.tsx there).
// POSTs to the already-live POST /api/v1/projexa/fraud-cases (createFraudCase
// in fraud-case-service.ts, FraudCaseInput = {title, fraudType,
// detectionSource, description, financialExposure, reportedDate,
// investigatorId, linkedRiskId}) -- zero new backend route. Requires
// requireRoleOrScope(ctx, "manager", "write").
//
// UI is compliance-tracker's own shadcn Card/Input/Select/Textarea (house
// convention), not PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FRAUD_TYPES = ["procurement", "payroll", "expense", "vendor_collusion", "asset_misappropriation", "other"];

export default function FraudCaseNewPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [fraudType, setFraudType] = useState("procurement");
  const [reportedDate, setReportedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createCase() {
    if (!title.trim() || !reportedDate) {
      toast.error("Title and reported date are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/fraud-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), fraudType, reportedDate, description: description || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to log case");
      toast.success("Case logged");
      router.push(`/grc/cases/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't log case");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Log a Fraud / Incident Case</h1>
        <p className="text-sm text-ct-muted mt-1">GRC / Fraud &amp; Incidents / New</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Case Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={submitting} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Type</Label>
              <Select value={fraudType} onValueChange={setFraudType} disabled={submitting}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FRAUD_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Reported Date</Label>
              <Input type="date" value={reportedDate} onChange={(e) => setReportedDate(e.target.value)} disabled={submitting} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Description (optional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={submitting} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/grc?tab=fraud")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={createCase}
          disabled={submitting || !title.trim() || !reportedDate}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Logging…" : "Log Case"}
        </Button>
      </div>
    </div>
  );
}
