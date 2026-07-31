"use client";

export const dynamic = "force-dynamic";

// Task #46 CRM feature-parity gap analysis (KERNEL_CONSOLIDATION_STATUS.md,
// finalized 2026-07-30), item 7: CRM-specific import/export for
// leads/opportunities/accounts/contacts. Minimal UI, same shape as the
// existing GST reconciliation import page (upload -> batch summary ->
// history list) -- see src/app/(app)/gst-reconciliation/page.tsx.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, Download, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type CrmImportEntity = "crm_lead" | "crm_opportunity" | "crm_account" | "crm_contact";

const ENTITY_LABELS: Record<CrmImportEntity, string> = {
  crm_lead: "Leads", crm_opportunity: "Opportunities", crm_account: "Accounts", crm_contact: "Contacts",
};

const STATUS_COLORS: Record<string, string> = {
  processing: "bg-ct-cloud text-ct-muted", confirmed: "bg-green-100 text-green-700", failed: "bg-red-100 text-red-700",
};

type Batch = {
  id: string; fileName: string; targetEntity: string; status: string;
  totalRows: number | null; confirmedCount: number | null; rejectedCount: number | null;
  uploadedBy: string; createdAt: string;
};

type ImportResult = { batchId: string; status: string; totalRows: number; insertedCount: number; rejectedCount: number; errors: { row: number; error: string }[] };

export default function CrmImportExportPage() {
  const [entity, setEntity] = useState<CrmImportEntity>("crm_lead");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);

  const loadBatches = useCallback(async (forEntity: CrmImportEntity) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/crm/import?entity=${forEntity}`);
      const data = await res.json();
      setBatches(data.batches ?? []);
    } catch {
      toast.error("Failed to load import history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBatches(entity); }, [entity, loadBatches]);

  const upload = async () => {
    if (!file) { toast.error("Choose a file first"); return; }
    setUploading(true);
    setLastResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entity", entity);
      const res = await fetch("/api/crm/import", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Import failed"); return; }
      setLastResult(data);
      toast.success(`Imported ${data.insertedCount} of ${data.totalRows} row(s)`);
      setFile(null);
      loadBatches(entity);
    } catch {
      toast.error("Import failed");
    } finally {
      setUploading(false);
    }
  };

  const exportCsv = async () => {
    const res = await fetch(`/api/crm/export?entity=${entity}`);
    if (!res.ok) { toast.error("Export failed"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entity}-export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">CRM Import / Export</h1>
        <p className="text-sm text-ct-muted mt-1">Bulk-import or export Leads, Opportunities, Accounts, and Contacts via CSV/Excel.</p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Entity</Label>
              <Select value={entity} onValueChange={(v) => setEntity(v as CrmImportEntity)}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ENTITY_LABELS) as CrmImportEntity[]).map((e) => <SelectItem key={e} value={e}>{ENTITY_LABELS[e]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">File (CSV / Excel)</Label>
              <Input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-[260px]" />
            </div>
            <Button onClick={upload} disabled={uploading || !file} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {uploading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Upload className="size-4 mr-2" />}
              Import
            </Button>
            <Button onClick={exportCsv} variant="outline">
              <Download className="size-4 mr-2" />
              Export {ENTITY_LABELS[entity]}
            </Button>
          </div>

          {lastResult && (
            <div className="rounded-md border border-ct-cloud p-3 text-sm space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-ct-teal" />
                <span>{lastResult.insertedCount} inserted, {lastResult.rejectedCount} rejected of {lastResult.totalRows} row(s).</span>
              </div>
              {lastResult.errors.length > 0 && (
                <ul className="text-xs text-ct-muted list-disc pl-5">
                  {lastResult.errors.slice(0, 10).map((e, i) => <li key={i}>Row {e.row}: {e.error}</li>)}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h2 className="text-sm font-semibold text-ct-navy mb-3">Import History -- {ENTITY_LABELS[entity]}</h2>
          {loading ? (
            <Loader2 className="size-5 animate-spin text-ct-muted" />
          ) : batches.length === 0 ? (
            <p className="text-sm text-ct-muted">No imports yet.</p>
          ) : (
            <div className="space-y-2">
              {batches.map((b) => (
                <div key={b.id} className="flex items-center justify-between text-sm border-b border-ct-cloud pb-2">
                  <div>
                    <span className="font-medium text-ct-navy">{b.fileName}</span>
                    <span className="text-ct-muted ml-2">by {b.uploadedBy} on {new Date(b.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ct-muted">{b.confirmedCount ?? 0}/{b.totalRows ?? 0} imported</span>
                    <Badge className={`text-xs border-0 ${STATUS_COLORS[b.status] ?? "bg-ct-cloud text-ct-muted"}`}>{b.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
