"use client";

export const dynamic = "force-dynamic";

// TDS Quarterly Return Data (Form 26Q / Form 24Q) -- aggregates real,
// already-computed TDS (erp_purchase_invoices.tds_amount, the payslip TDS
// deduction line) into the NSDL/TRACES quarterly-return field shape.
// Computed at read time, not persisted (same posture as the ERP financial
// reports). No challan-payment tracking exists yet, so BSR code/challan
// number/deposit date are left for the CA to fill in -- see
// tds-return-generator.ts's header comment.
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, FileJson, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function TdsReturnsPage() {
  const currentYear = new Date().getFullYear();
  const [fyStart, setFyStart] = useState(String(currentYear - 1));
  const [quarter, setQuarter] = useState("1");
  const [loading26Q, setLoading26Q] = useState(false);
  const [loading24Q, setLoading24Q] = useState(false);
  const [report26Q, setReport26Q] = useState<Record<string, unknown> | null>(null);
  const [report24Q, setReport24Q] = useState<Record<string, unknown> | null>(null);

  const generate = async (formType: "26q" | "24q") => {
    const setLoading = formType === "26q" ? setLoading26Q : setLoading24Q;
    const setReport = formType === "26q" ? setReport26Q : setReport24Q;
    setLoading(true);
    const res = await fetch(`/api/tds-returns/${formType}?financialYearStart=${fyStart}&quarter=${quarter}`);
    setLoading(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? `Failed to generate Form ${formType.toUpperCase()}`); return; }
    const d = await res.json();
    setReport(d.report);
    toast.success(`Form ${formType.toUpperCase()} generated`);
  };

  const download = (report: Record<string, unknown> | null, name: string) => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">TDS Quarterly Returns</h1>
        <p className="text-sm text-ct-muted mt-1">Form 26Q (non-salary) and Form 24Q (salary) data, aggregated from real TDS already computed elsewhere in the ERP — challan details (BSR code, deposit date) must still be added from your own records before filing</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-4 flex gap-3 items-end">
          <div><Label>Financial Year Start</Label><Input type="number" value={fyStart} onChange={e => setFyStart(e.target.value)} className="w-32" /></div>
          <div><Label>Quarter</Label>
            <Select value={quarter} onValueChange={setQuarter}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="1">Q1 (Apr-Jun)</SelectItem><SelectItem value="2">Q2 (Jul-Sep)</SelectItem><SelectItem value="3">Q3 (Oct-Dec)</SelectItem><SelectItem value="4">Q4 (Jan-Mar)</SelectItem></SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="26q">
        <TabsList><TabsTrigger value="26q">Form 26Q</TabsTrigger><TabsTrigger value="24q">Form 24Q</TabsTrigger></TabsList>

        <TabsContent value="26q" className="space-y-3">
          <div className="flex gap-2">
            <Button onClick={() => generate("26q")} disabled={loading26Q} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{loading26Q && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}<Sparkles className="w-3.5 h-3.5 mr-1" />Generate</Button>
            {report26Q && <Button variant="outline" onClick={() => download(report26Q, "form_26q")}><FileJson className="w-3.5 h-3.5 mr-1" />Download</Button>}
          </div>
          {report26Q && <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4"><pre className="text-xs bg-ct-cloud/40 p-3 rounded-lg overflow-auto max-h-96">{JSON.stringify(report26Q, null, 2)}</pre></CardContent></Card>}
        </TabsContent>

        <TabsContent value="24q" className="space-y-3">
          <div className="flex gap-2">
            <Button onClick={() => generate("24q")} disabled={loading24Q} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{loading24Q && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}<Sparkles className="w-3.5 h-3.5 mr-1" />Generate</Button>
            {report24Q && <Button variant="outline" onClick={() => download(report24Q, "form_24q")}><FileJson className="w-3.5 h-3.5 mr-1" />Download</Button>}
          </div>
          {report24Q && <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4"><pre className="text-xs bg-ct-cloud/40 p-3 rounded-lg overflow-auto max-h-96">{JSON.stringify(report24Q, null, 2)}</pre></CardContent></Card>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
