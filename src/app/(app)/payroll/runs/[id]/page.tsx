"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge, module 23/24 (payroll): payroll run detail / object
// page. Ported from PROJEXA's own PayrollRunObjectClient.tsx, rebuilt on
// this repo's own house pattern (Card/Table, see
// src/app/(app)/moms/[id]/page.tsx's real workflow detail page) instead of
// PROJEXA's own ObjectScreen archetype.
//
// No generic Edit/Delete -- a payroll run has no update/delete function in
// erp-payroll-service.ts, only Process (draft -> processed).
//
// CONFIRMED BACKEND CONTRACT: GET /api/v1/projexa/payroll/runs/:id returns
// the bare run row; GET .../runs/:id/payslips returns { payslips }, each
// row already carrying a merged employeeName (listPayslips' own join).
// POST .../runs/:id/process (erp-payroll-service.ts's processPayrollRun)
// requires a real VERIDIAN session user for its audit trail (same posture
// as every payroll write action) and returns { run, payslipCount }.
//
// Real enum (erp_payroll_run_status): draft | processed | paid | cancelled
// -- confirmed against the live schema, not assumed from PROJEXA's own UI
// (which only ever distinguished "processed" from everything else).
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, FileDown, Loader2, PlayCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type PayrollRun = { id: string; month: number; year: number; status: string; processedAt: string | null };
type Payslip = { id: string; employeeId: string; employeeName: string; grossEarnings: string; totalDeductions: string; netPay: string; status: string };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary", processed: "default", paid: "default", cancelled: "destructive",
};

export default function PayrollRunDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const runId = params.id;

  const [run, setRun] = useState<PayrollRun | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [runRes, payslipRes] = await Promise.all([
        fetch(`/api/v1/projexa/payroll/runs/${runId}`),
        fetch(`/api/v1/projexa/payroll/runs/${runId}/payslips`),
      ]);
      const runData = await runRes.json().catch(() => null);
      if (!runRes.ok) throw new Error(runData?.error ?? "Couldn't load this payroll run");
      const payslipData = await payslipRes.json().catch(() => ({ payslips: [] }));
      setRun(runData);
      setPayslips(payslipData.payslips ?? []);
      setLoadError(null);
    } catch (err) {
      setRun(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this payroll run");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => { void load(); }, [load]);

  async function process() {
    setProcessing(true);
    try {
      const res = await fetch(`/api/v1/projexa/payroll/runs/${runId}/process`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to process payroll run");
      toast.success(`Processed -- ${data.payslipCount ?? 0} payslip(s) generated`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't process payroll run");
    } finally {
      setProcessing(false);
    }
  }

  function exportCsv() {
    if (payslips.length === 0 || !run) return;
    const header = "Employee,Gross Earnings,Total Deductions,Net Pay,Status";
    const rows = payslips.map((p) => `${p.employeeName},${p.grossEarnings},${p.totalDeductions},${p.netPay},${p.status}`);
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-register-${run.year}-${String(run.month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (loadError || !run) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Payroll run not found."}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/payroll" className="inline-flex items-center gap-1 text-xs text-ct-muted hover:text-ct-navy">
        <ArrowLeft className="size-3.5" /> Back to Payroll
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">{MONTHS[run.month - 1]} {run.year}</h1>
            <Badge variant={STATUS_VARIANT[run.status] ?? "outline"}>{run.status}</Badge>
          </div>
          <p className="text-sm text-ct-muted mt-1">Processed: {run.processedAt ? new Date(run.processedAt).toLocaleString() : "—"}</p>
        </div>
        <div className="flex items-center gap-2">
          {run.status === "draft" && (
            <Button size="sm" disabled={processing} onClick={() => void process()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {processing ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <PlayCircle className="size-4 mr-1.5" />}
              {processing ? "Processing…" : "Process"}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={payslips.length === 0} onClick={exportCsv}>
            <FileDown className="size-4 mr-1.5" /> Export CSV
          </Button>
        </div>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Payslips</CardTitle></CardHeader>
        <CardContent className="p-0">
          {payslips.length === 0 ? (
            <p className="py-10 text-center text-sm text-ct-muted">No payslips yet — process this run first.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Employee</TableHead><TableHead>Gross</TableHead><TableHead>Deductions</TableHead><TableHead>Net Pay</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {payslips.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/payroll/runs/${runId}/payslips/${p.id}`)}>
                    <TableCell className="font-medium text-ct-navy">{p.employeeName}</TableCell>
                    <TableCell>{Number(p.grossEarnings).toLocaleString()}</TableCell>
                    <TableCell>{Number(p.totalDeductions).toLocaleString()}</TableCell>
                    <TableCell className="font-medium">{Number(p.netPay).toLocaleString()}</TableCell>
                    <TableCell><Badge variant={p.status === "finalized" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
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
