"use client";

// VERI FM & CS AI OS -- the minimal real entry point for the "photo of a
// physical asset register" digitization path (Wave 107's service layer,
// previously built with zero UI or API route -- see
// fm-register-digitization-service.ts). Deliberately not linked from the
// main sidebar yet (VERI FM & CS's broader nav rollout is a separate,
// not-yet-made product decision); this page is reachable directly and is
// gated the same way every other FM surface is -- requireFmEnabled() inside
// the API routes it calls returns 403 for any org that hasn't enabled FM.
//
// Flow: pick/capture a photo -> run a client-side Laplacian-variance blur
// check for free (no upload wasted on an unreadable photo) -> upload via the
// existing /api/documents (real storage, real documents row) -> call the
// new /api/fm/register-digitization/photo route to run AI extraction ->
// display the extracted rows. Reviewing/editing/committing rows into real
// fmAssets is a distinct, separately-gated next step (reviewDigitizationRow/
// commitDigitizationBatch already exist in the service layer) and is
// out of scope for this minimal wiring pass.
import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { checkPhotoBlur, type BlurCheckResult } from "@/lib/fm-photo-blur-check";

type ExtractedRow = {
  id: string;
  sourceRowNumber: number | null;
  confidence: string | null;
  extractedData: { assetName: string | null; categoryHint: string | null; make: string | null; model: string | null; locationLabel: string | null; warnings: string[] };
};

type Step = "pick" | "checked" | "uploading" | "extracting" | "done";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function FmRegisterDigitizationPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [blur, setBlur] = useState<BlurCheckResult | null>(null);
  const [step, setStep] = useState<Step>("pick");
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [rows, setRows] = useState<ExtractedRow[]>([]);

  const reset = () => {
    setFile(null); setPreviewUrl(null); setBlur(null); setStep("pick");
    setError(null); setBatchId(null); setRows([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setError(null);
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    try {
      const result = await checkPhotoBlur(selected);
      setBlur(result);
      setStep("checked");
    } catch {
      setError("Could not analyze this photo in the browser -- you can still upload it.");
      setStep("checked");
    }
  };

  const upload = async () => {
    if (!file) return;
    setError(null);
    setStep("uploading");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", "fm_register_photo");
      const uploadRes = await fetch("/api/documents", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || "Upload failed");

      setStep("extracting");
      const imageBase64 = await fileToBase64(file);
      const extractRes = await fetch("/api/fm/register-digitization/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: uploadData.id, imageBase64, mimeType: file.type }),
      });
      const extractData = await extractRes.json();
      if (!extractRes.ok) throw new Error(extractData.error || "Extraction failed");

      setBatchId(extractData.batchId);
      const rowsRes = await fetch(`/api/fm/register-digitization/${extractData.batchId}/rows`);
      const rowsData = await rowsRes.json();
      if (rowsRes.ok) setRows(rowsData.rows ?? []);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("checked");
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Digitize a Register Photo</h1>
        <p className="text-sm text-ct-muted mt-1">Photograph a physical asset register page and AI extracts the rows for review.</p>
      </div>

      {error && (
        <Card className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</Card>
      )}

      {step !== "done" && (
        <Card className="rounded-xl shadow-card bg-white p-4 space-y-3">
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={onFileChange} className="text-sm" />

          {previewUrl && (
            <div className="flex items-start gap-4">
              <img src={previewUrl} alt="Selected register page" className="w-40 h-40 object-cover rounded-lg border" />
              {blur && (
                <div className="text-sm space-y-1">
                  <Badge className={blur.isBlurry ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}>
                    {blur.isBlurry ? "May be too blurry to read" : "Looks sharp"}
                  </Badge>
                  <p className="text-ct-muted">Sharpness score: {blur.variance.toFixed(0)}</p>
                  {blur.isBlurry && <p className="text-ct-muted">Consider retaking the photo with better lighting or holding the camera steadier.</p>}
                </div>
              )}
            </div>
          )}

          {file && (
            <Button
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
              disabled={step === "uploading" || step === "extracting"}
              onClick={upload}
            >
              {step === "uploading" ? "Uploading…" : step === "extracting" ? "Reading register…" : "Upload & Extract"}
            </Button>
          )}
        </Card>
      )}

      {step === "done" && (
        <Card className="rounded-xl shadow-card bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm">Extracted <strong>{rows.length}</strong> row{rows.length === 1 ? "" : "s"} from batch {batchId}.</p>
            <Button size="sm" variant="outline" onClick={reset}>Digitize another photo</Button>
          </div>
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ct-muted border-b">
                    <th className="py-1 pr-3">#</th>
                    <th className="py-1 pr-3">Asset name</th>
                    <th className="py-1 pr-3">Category</th>
                    <th className="py-1 pr-3">Make / Model</th>
                    <th className="py-1 pr-3">Location</th>
                    <th className="py-1 pr-3">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="py-1 pr-3">{row.sourceRowNumber}</td>
                      <td className="py-1 pr-3">{row.extractedData.assetName ?? "—"}</td>
                      <td className="py-1 pr-3">{row.extractedData.categoryHint ?? "—"}</td>
                      <td className="py-1 pr-3">{[row.extractedData.make, row.extractedData.model].filter(Boolean).join(" / ") || "—"}</td>
                      <td className="py-1 pr-3">{row.extractedData.locationLabel ?? "—"}</td>
                      <td className="py-1 pr-3">{row.confidence ? `${Math.round(Number(row.confidence) * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ct-muted">Rows are staged for review, not yet committed to the asset register.</p>
        </Card>
      )}
    </div>
  );
}
