"use client";

export const dynamic = "force-dynamic";

// Wave 92: per-system backup verification log + failover test history.
import { useEffect, useState, useCallback, use as usePromise } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type BackupVerification = { id: string; verificationDate: string; status: string; notes: string | null };
type FailoverTest = { id: string; testDate: string; testType: string; outcome: string; findings: string | null };
type DrPlanDetail = {
  id: string; systemName: string; rtoHours: string; rpoHours: string; criticalityLevel: string;
  backupVerifications: BackupVerification[]; failoverTests: FailoverTest[];
};

const OUTCOME_VARIANT: Record<string, "default" | "secondary" | "outline"> = { success: "default", passed: "default", failed: "outline", partial: "secondary" };

export default function DrPlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [plan, setPlan] = useState<DrPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [verificationDate, setVerificationDate] = useState(new Date().toISOString().slice(0, 10));
  const [verificationStatus, setVerificationStatus] = useState("success");
  const [savingVerification, setSavingVerification] = useState(false);

  const [testDate, setTestDate] = useState(new Date().toISOString().slice(0, 10));
  const [testType, setTestType] = useState("tabletop");
  const [testOutcome, setTestOutcome] = useState("passed");
  const [savingTest, setSavingTest] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/it-dr/${id}`);
    const data = await res.json();
    setPlan(data);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function recordVerification() {
    setSavingVerification(true);
    const res = await fetch(`/api/it-dr/${id}/backup-verifications`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verificationDate, status: verificationStatus }),
    });
    setSavingVerification(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to record verification"); return; }
    toast.success("Backup verification recorded");
    load();
  }

  async function recordTest() {
    setSavingTest(true);
    const res = await fetch(`/api/it-dr/${id}/failover-tests`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ testDate, testType, outcome: testOutcome }),
    });
    setSavingTest(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to record test"); return; }
    toast.success("Failover test recorded");
    load();
  }

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!plan) return <p className="text-sm text-ct-muted">DR plan not found.</p>;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/it-dr" className="text-xs text-ct-muted hover:text-ct-navy flex items-center gap-1 mb-2">
          <ArrowLeft className="size-3" /> Back to IT Disaster Recovery
        </Link>
        <h1 className="text-2xl font-heading text-ct-navy">{plan.systemName}</h1>
        <p className="text-sm text-ct-muted">RTO {plan.rtoHours}h · RPO {plan.rpoHours}h · <Badge variant="outline">{plan.criticalityLevel}</Badge></p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-4 space-y-3">
            <h3 className="font-medium text-ct-navy text-sm">Backup Verifications</h3>
            <div className="flex gap-2">
              <Input type="date" value={verificationDate} onChange={(e) => setVerificationDate(e.target.value)} className="flex-1" />
              <Select value={verificationStatus} onValueChange={setVerificationStatus}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="success">Success</SelectItem><SelectItem value="partial">Partial</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent>
              </Select>
              <Button size="sm" onClick={recordVerification} disabled={savingVerification}>{savingVerification ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}</Button>
            </div>
            <ul className="space-y-1 text-xs">
              {plan.backupVerifications.length === 0 ? <li className="text-ct-muted">None recorded.</li> : plan.backupVerifications.map((v) => (
                <li key={v.id} className="flex items-center justify-between">
                  <span>{v.verificationDate}</span>
                  <Badge variant={OUTCOME_VARIANT[v.status] ?? "outline"}>{v.status}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-4 space-y-3">
            <h3 className="font-medium text-ct-navy text-sm">Failover Tests</h3>
            <div className="flex flex-wrap gap-2">
              <Input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} className="flex-1 min-w-[110px]" />
              <Select value={testType} onValueChange={setTestType}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="tabletop">Tabletop</SelectItem><SelectItem value="partial_failover">Partial Failover</SelectItem><SelectItem value="full_failover">Full Failover</SelectItem></SelectContent>
              </Select>
              <Select value={testOutcome} onValueChange={setTestOutcome}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="passed">Passed</SelectItem><SelectItem value="partial">Partial</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent>
              </Select>
              <Button size="sm" onClick={recordTest} disabled={savingTest}>{savingTest ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}</Button>
            </div>
            <ul className="space-y-1 text-xs">
              {plan.failoverTests.length === 0 ? <li className="text-ct-muted">None recorded.</li> : plan.failoverTests.map((t) => (
                <li key={t.id} className="flex items-center justify-between">
                  <span>{t.testDate} — {t.testType.replaceAll("_", " ")}</span>
                  <Badge variant={OUTCOME_VARIANT[t.outcome] ?? "outline"}>{t.outcome}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
