"use client";

// "Need a Report / Need an Analysis" upload-to-AI flow (Owner request,
// 2026-07-13). Upload an image/Excel/Word file describing what you want
// analyzed; /api/reports/ai-builder/analyze (ai-report-builder-service.ts)
// extracts its REAL content and proposes a structured report grounded in
// that content only. Nothing is saved until the user reviews the proposal
// below and clicks "Save Report" -- that POST goes through the same,
// pre-existing /api/reports/saved -> createSavedReport() every other saved
// report in this app uses (custom-report-service.ts), org-scoped via
// ctx.orgId exactly like them, so it becomes a normal, redisplayable saved
// report (rendered by CustomReportsSection.tsx on /reports) going forward.
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Upload, Sparkles, Loader2, FileImage, FileSpreadsheet, FileType2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AiGeneratedReportData = {
  title: string;
  summary: string;
  columns: string[];
  rows: Record<string, string | number>[];
  chartType: string;
  chartRows: { groupValue: string; count: number }[];
};

const ACCEPTED_TYPES = ".jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv,.docx";

export default function CreateAiReportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [proposal, setProposal] = useState<AiGeneratedReportData | null>(null);
  const [extractedPreview, setExtractedPreview] = useState<string>("");
  const [reportName, setReportName] = useState("");

  const reset = useCallback(() => {
    setFileName(null);
    setProposal(null);
    setExtractedPreview("");
    setReportName("");
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setAnalyzing(true);
    setProposal(null);
    setFileName(file.name);

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/reports/ai-builder/analyze", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");

      setProposal(data.proposal as AiGeneratedReportData);
      setExtractedPreview(data.extractedPreview ?? "");
      setReportName((data.proposal as AiGeneratedReportData).title || file.name);
    } catch (err) {
      setError((err as Error).message);
      setFileName(null);
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const saveReport = async () => {
    if (!proposal || !reportName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reports/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: reportName.trim(),
          sourceEntity: "ai_generated",
          chartType: proposal.chartType,
          aiGeneratedData: proposal,
          sourceFileName: fileName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save report");
      toast.success("Report saved");
      router.push(`/reports?report=${data.id}#custom-reports`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link href="/reports" className="inline-flex items-center gap-1.5 text-sm text-ct-muted hover:text-ct-navy transition-colors mb-2">
          <ArrowLeft className="size-3.5" />
          Back to Reports
        </Link>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2">
          <Sparkles className="size-6 text-ct-saffron" />
          Need a Report? Upload &amp; let AI build it
        </h1>
        <p className="text-sm text-ct-muted mt-1">
          Upload an image, Excel spreadsheet, or Word document describing what you want analyzed. AI reads its real
          content and proposes a structured report -- it never invents numbers that aren&apos;t in your file.
        </p>
      </div>

      {!proposal && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-6">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={`rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
                dragOver ? "border-ct-saffron bg-ct-saffron/5" : "border-ct-border hover:border-ct-saffron/50"
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED_TYPES}
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {analyzing ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="size-8 text-ct-saffron animate-spin" />
                  <p className="text-sm font-medium text-ct-navy">Analyzing {fileName}...</p>
                  <p className="text-xs text-ct-muted">Extracting content and proposing a report -- this can take a few seconds.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="size-8 text-ct-muted" />
                  <p className="text-sm font-medium text-ct-navy">Drop a file here, or click to browse</p>
                  <p className="text-xs text-ct-muted">Image (JPEG/PNG/WebP), Excel (.xlsx/.xls/.csv), or Word (.docx)</p>
                  <div className="flex items-center gap-3 mt-1 text-ct-muted">
                    <FileImage className="size-4" />
                    <FileSpreadsheet className="size-4" />
                    <FileType2 className="size-4" />
                  </div>
                </div>
              )}
            </div>
            {error && <p className="text-sm text-ct-error mt-4">{error}</p>}
          </CardContent>
        </Card>
      )}

      {proposal && (
        <div className="space-y-4">
          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold text-ct-navy">Review Proposed Report</CardTitle>
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw className="size-3.5 mr-1.5" />
                Start Over
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Report Name</Label>
                <Input value={reportName} onChange={(e) => setReportName(e.target.value)} placeholder="Report name" />
              </div>
              {proposal.summary && <p className="text-sm text-ct-muted">{proposal.summary}</p>}

              <div className="overflow-x-auto rounded border border-ct-border">
                <table className="w-full text-xs">
                  <thead className="bg-ct-navy text-white">
                    <tr>
                      {proposal.columns.map((col) => (
                        <th key={col} className="py-2 px-3 text-left font-medium whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ct-border">
                    {proposal.rows.map((row, i) => (
                      <tr key={i} className={i % 2 === 1 ? "bg-ct-cloud/40" : ""}>
                        {proposal.columns.map((col) => (
                          <td key={col} className="py-2 px-3 whitespace-nowrap">{String(row[col] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <details className="text-xs text-ct-muted">
                <summary className="cursor-pointer font-medium text-ct-navy">Source content used (grounding)</summary>
                <pre className="whitespace-pre-wrap mt-2 p-3 bg-ct-cloud/40 rounded max-h-[200px] overflow-y-auto">{extractedPreview}</pre>
              </details>

              <div className="flex justify-end gap-2 pt-2">
                <Button onClick={saveReport} disabled={saving || !reportName.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
                  {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Sparkles className="size-4 mr-2" />}
                  Save Report
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
