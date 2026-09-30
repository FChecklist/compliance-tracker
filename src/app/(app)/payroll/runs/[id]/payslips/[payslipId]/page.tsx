"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge, module 23/24 (payroll): payslip detail / object
// page. Ported from PROJEXA's own PayslipObjectClient.tsx, rebuilt on this
// repo's own house pattern (Card/Table, see
// src/app/(app)/moms/[id]/page.tsx) instead of PROJEXA's own ObjectScreen
// archetype.
//
// CONFIRMED BACKEND CONTRACT (erp-payroll-service.ts's getPayslipDetail,
// read directly -- PROJEXA's own client only destructured { payslip,
// employeeName } from this same response, but the route returns more:
// { payslip, run, employeeName, employeeEmail, employeeCode, jobTitle,
// org }). payslip.status is 'draft' | 'finalized'. updatePayslipTds (POST
// .../tds) and finalizePayslip (POST .../finalize) both refuse once the
// payslip is no longer 'draft'. GET .../pdf is a real, plain cookie-authed
// GET, safe as a bare <a href>.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, FileText, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type PayslipLine = { id: string; label: string; lineType: "earning" | "deduction"; amount: string };
type PayslipDetail = {
  payslip: { id: string; payrollRunId: string; status: string; grossEarnings: string; totalDeductions: string; netPay: string; lines: PayslipLine[] };
  employeeName: string;
};

export default function PayslipDetailPage() {
  const params = useParams<{ id: string; payslipId: string }>();
  const runId = params.id;
  const payslipId = params.payslipId;

  const [detail, setDetail] = useState<PayslipDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tdsAmount, setTdsAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/v1/projexa/payroll/payslips/${payslipId}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load this payslip");
      setDetail(data);
      setTdsAmount(data.payslip.lines.find((l: PayslipLine) => l.label.startsWith("TDS"))?.amount ?? "");
      setLoadError(null);
    } catch (err) {
      setDetail(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this payslip");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, [payslipId]);

  async function saveTds() {
    setBusy("tds");
    try {
      const res = await fetch(`/api/v1/projexa/payroll/payslips/${payslipId}/tds`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tdsAmount: Number(tdsAmount) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to update TDS");
      toast.success("TDS updated");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update TDS");
    } finally {
      setBusy(null);
    }
  }

  async function finalize() {
    setBusy("finalize");
    try {
      const res = await fetch(`/api/v1/projexa/payroll/payslips/${payslipId}/finalize`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to finalize payslip");
      toast.success("Payslip finalized");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't finalize payslip");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (loadError || !detail) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Payslip not found."}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  const { payslip, employeeName } = detail;
  const isDraft = payslip.status === "draft";

  return (
    <div className="space-y-4">
      <Link href={`/payroll/runs/${runId}`} className="inline-flex items-center gap-1 text-xs text-ct-muted hover:text-ct-navy">
        <ArrowLeft className="size-3.5" /> Back to Payroll Run
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">Payslip — {employeeName}</h1>
            <Badge variant={isDraft ? "secondary" : "default"}>{payslip.status}</Badge>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/v1/projexa/payroll/payslips/${payslipId}/pdf`} target="_blank" rel="noopener noreferrer">
            <FileText className="size-4 mr-1.5" /> Download PDF
          </a>
        </Button>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Earnings &amp; Deductions</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableBody>
              {payslip.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.label}</TableCell>
                  <TableCell className={l.lineType === "deduction" ? "text-right text-red-600" : "text-right"}>
                    {l.lineType === "deduction" ? "-" : ""}{Number(l.amount).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-semibold text-ct-navy">Net Pay</TableCell>
                <TableCell className="text-right font-semibold text-ct-navy">{Number(payslip.netPay).toLocaleString()}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isDraft && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">TDS &amp; Finalize</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-40 space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">TDS Amount (manual override)</Label>
              <Input type="number" value={tdsAmount} onChange={(e) => setTdsAmount(e.target.value)} />
            </div>
            <Button variant="outline" disabled={busy === "tds"} onClick={() => void saveTds()}>
              {busy === "tds" ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : null}
              {busy === "tds" ? "Saving…" : "Save TDS"}
            </Button>
            <Button disabled={busy === "finalize"} onClick={() => void finalize()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {busy === "finalize" ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : null}
              {busy === "finalize" ? "Finalizing…" : "Finalize Payslip"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
