"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileText,
  Sparkles,
  Loader2,
  Pencil,
  Link2,
  ArrowRight,
  CheckCircle2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ExtractedData = {
  noticeNumber: string | null;
  authority: string | null;
  demandAmount: number | null;
  pan: string | null;
  gstin: string | null;
  arn: string | null;
  period: string | null;
  dueDate: string | null;
  complianceType: string | null;
  description: string | null;
  title: string | null;
};

const COMPLIANCE_TYPES = [
  "GST",
  "TDS",
  "MCA",
  "PF",
  "ESIC",
  "INCOME_TAX",
  "ROC",
  "LABOUR",
  "ENVIRONMENTAL",
  "OTHER",
];

type Department = { id: string; name: string };

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  noticeNumber: "Notice / Reference No.",
  authority: "Issuing Authority",
  demandAmount: "Demand Amount (₹)",
  pan: "PAN",
  gstin: "GSTIN",
  arn: "ARN",
  period: "Period",
  dueDate: "Due Date",
  complianceType: "Compliance Type",
  description: "Description",
};

// Fields to show in the review form (editable)
const EDITABLE_FIELDS = [
  "title",
  "complianceType",
  "authority",
  "noticeNumber",
  "demandAmount",
  "pan",
  "gstin",
  "arn",
  "period",
  "dueDate",
  "description",
] as const;

type FieldKey = (typeof EDITABLE_FIELDS)[number];

export function DocumentUploadSection() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload state
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Extraction state
  const [extracting, setExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);

  // Edit form state
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDept, setSelectedDept] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkItemId, setLinkItemId] = useState("");
  const [creating, setCreating] = useState(false);

  const loadDepartments = useCallback(() => {
    fetch("/api/departments")
      .then((r) => r.json())
      .then((d) => setDepartments(d.departments ?? d))
      .catch(() => {});
  }, []);

  // Handle drag events
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      setFile(e.dataTransfer.files[0]);
      setExtractedData(null);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setExtractedData(null);
    }
  };

  // Extract with AI
  const handleExtract = useCallback(async () => {
    if (!file) return;

    setExtracting(true);
    setExtractedData(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/documents/extract", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Extraction failed" }));
        throw new Error(err.error);
      }

      const data = await res.json();
      const extracted = data.extractedData as ExtractedData;
      setExtractedData(extracted);

      // Populate edit form with extracted values
      const form: Record<string, string> = {};
      for (const key of EDITABLE_FIELDS) {
        const val = extracted[key];
        form[key] = val !== null && val !== undefined ? String(val) : "";
      }
      setEditForm(form);

      // Load departments for the "Create from Extraction" flow
      loadDepartments();

      toast.success("AI extraction complete!");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to extract data"
      );
    } finally {
      setExtracting(false);
    }
  }, [file, loadDepartments]);

  // Create compliance item from extracted data
  const handleCreateFromExtraction = useCallback(async () => {
    if (!selectedDept) {
      toast.error("Please select a department");
      return;
    }

    setCreating(true);
    try {
      const payload: Record<string, unknown> = {
        title:
          editForm.title ||
          extractedData?.title ||
          "Compliance from Document",
        description: editForm.description || extractedData?.description || "",
        complianceType:
          editForm.complianceType || extractedData?.complianceType || "OTHER",
        priority: "high",
        departmentId: selectedDept,
      };

      if (editForm.dueDate || extractedData?.dueDate) {
        payload.dueDate = editForm.dueDate || extractedData?.dueDate;
      }
      if (editForm.period || extractedData?.period) {
        payload.period = editForm.period || extractedData?.period;
      }
      if (editForm.noticeNumber || extractedData?.noticeNumber) {
        payload.acknowledgementNumber =
          editForm.noticeNumber || extractedData?.noticeNumber;
      }
      if (
        editForm.demandAmount &&
        !isNaN(Number(editForm.demandAmount))
      ) {
        payload.amount = Number(editForm.demandAmount);
      }

      const res = await fetch("/api/compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Create failed" }));
        throw new Error(err.error);
      }

      const created = await res.json();
      toast.success("Compliance item created from document!");
      router.push(`/compliance/${created.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create compliance item"
      );
    } finally {
      setCreating(false);
    }
  }, [editForm, extractedData, selectedDept, router]);

  // Attach to existing compliance item
  const handleAttachToExisting = useCallback(async () => {
    if (!linkItemId.trim()) {
      toast.error("Please enter a compliance item ID");
      return;
    }

    setLinking(true);
    try {
      // Verify the item exists
      const check = await fetch(`/api/compliance/${linkItemId.trim()}`);
      if (!check.ok) throw new Error("Compliance item not found");

      toast.success(
        `Document would be attached to item ${linkItemId.trim()} (linking not yet implemented in demo)`
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to link document"
      );
    } finally {
      setLinking(false);
    }
  }, [linkItemId]);

  const updateFormField = (key: string, value: string) => {
    setEditForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-4">
      {/* Upload Zone */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-ct-navy flex items-center gap-2">
            <Upload className="size-4 text-ct-saffron" />
            Upload Document
          </CardTitle>
          <CardDescription className="text-xs text-ct-muted">
            Upload a compliance document (PDF, text) and let AI extract the key fields.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all",
              dragActive
                ? "border-ct-saffron bg-amber-50/50"
                : file
                  ? "border-ct-teal bg-teal-50/30"
                  : "border-ct-border2 hover:border-ct-saffron hover:bg-ct-cloud/50"
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.txt,.csv,.json"
              onChange={handleFileSelect}
            />
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <div className="size-12 rounded-xl bg-ct-teal/10 flex items-center justify-center">
                  <FileText className="size-6 text-ct-teal" />
                </div>
                <p className="text-sm font-medium text-ct-navy">{file.name}</p>
                <p className="text-xs text-ct-muted">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
                <button
                  className="text-xs text-ct-muted hover:text-ct-navy mt-1 flex items-center gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setExtractedData(null);
                  }}
                >
                  <X className="size-3" /> Remove
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="size-12 rounded-xl bg-ct-cloud flex items-center justify-center">
                  <Upload className="size-6 text-ct-muted" />
                </div>
                <p className="text-sm text-ct-navy font-medium">
                  Drop your document here or click to browse
                </p>
                <p className="text-xs text-ct-muted">
                  Supports PDF, TXT, CSV
                </p>
              </div>
            )}
          </div>

          {/* Extract Button */}
          {file && !extractedData && (
            <Button
              className="w-full mt-4 bg-ct-saffron hover:bg-ct-saffron-hover text-white"
              onClick={handleExtract}
              disabled={extracting}
            >
              {extracting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Extracting with AI...
                </>
              ) : (
                <>
                  <Sparkles className="size-4 mr-2" />
                  Extract Fields with AI
                </>
              )}
            </Button>
          )}

          {/* Extraction Loading Skeleton */}
          {extracting && (
            <Card className="mt-4 rounded-xl border-ct-saffron/20 bg-amber-50/30">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-ct-saffron animate-pulse" />
                  <span className="text-sm font-medium text-ct-navy">
                    AI is analyzing your document...
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {/* Review Extracted Data */}
      {extractedData && (
        <Card className="rounded-xl shadow-card bg-white border-ct-teal/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-ct-teal/10 flex items-center justify-center">
                  <CheckCircle2 className="size-4 text-ct-teal" />
                </div>
                <div>
                  <CardTitle className="text-base text-ct-navy">
                    Review Extracted Data
                  </CardTitle>
                  <CardDescription className="text-xs text-ct-muted">
                    AI extracted these fields — edit any values before creating.
                  </CardDescription>
                </div>
              </div>
              <Badge
                variant="secondary"
                className="bg-ct-teal/10 text-ct-teal text-[10px]"
              >
                AI Extracted
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {EDITABLE_FIELDS.map((key) => {
                if (key === "description") return null; // Description shown separately below
                const isSelect = key === "complianceType";
                const isNumber = key === "demandAmount";
                const isDate = key === "dueDate";

                return (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] font-semibold text-ct-muted uppercase flex items-center gap-1">
                      <Pencil className="size-2.5" />
                      {FIELD_LABELS[key]}
                    </Label>
                    {isSelect ? (
                      <Select
                        value={editForm[key] || ""}
                        onValueChange={(v) => updateFormField(key, v)}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          {COMPLIANCE_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t.replace("_", " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={isNumber ? "number" : isDate ? "date" : "text"}
                        value={editForm[key] || ""}
                        onChange={(e) => updateFormField(key, e.target.value)}
                        className="h-9 text-sm"
                        placeholder={key === "title" ? "Compliance item title" : `Enter ${FIELD_LABELS[key].toLowerCase()}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Description (full width) */}
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-ct-muted uppercase flex items-center gap-1">
                <Pencil className="size-2.5" />
                {FIELD_LABELS.description}
              </Label>
              <textarea
                value={editForm.description || ""}
                onChange={(e) => updateFormField("description", e.target.value)}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[60px] resize-y"
                placeholder="Description of the compliance item..."
                rows={2}
              />
            </div>

            {/* Department Selection (required for creation) */}
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-ct-muted uppercase">
                Department <span className="text-red-500">*</span>
              </Label>
              <Select value={selectedDept} onValueChange={setSelectedDept}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                className="flex-1 bg-ct-teal hover:bg-ct-teal-hover text-white"
                onClick={handleCreateFromExtraction}
                disabled={creating || !selectedDept}
              >
                {creating ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4 mr-2" />
                )}
                Create Compliance from Extraction
              </Button>

              <div className="flex items-center gap-2">
                <span className="text-xs text-ct-muted">or</span>
              </div>

              <div className="flex gap-2 flex-1">
                <Input
                  placeholder="Enter item ID to attach..."
                  value={linkItemId}
                  onChange={(e) => setLinkItemId(e.target.value)}
                  className="h-9 text-sm flex-1"
                />
                <Button
                  variant="outline"
                  className="h-9 shrink-0"
                  onClick={handleAttachToExisting}
                  disabled={linking || !linkItemId.trim()}
                >
                  {linking ? (
                    <Loader2 className="size-4 mr-1.5 animate-spin" />
                  ) : (
                    <Link2 className="size-4 mr-1.5" />
                  )}
                  <span className="hidden sm:inline">Attach</span>
                  <ArrowRight className="size-3 sm:hidden" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}