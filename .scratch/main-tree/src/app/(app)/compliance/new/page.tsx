"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Sparkles, ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  COMPLIANCE_TEMPLATES,
  type ComplianceTemplate,
} from "@/lib/compliance-templates";

type Department = { id: string; name: string };

const COMPLIANCE_TYPES = [
  "GST", "TDS", "MCA", "PF", "ESIC", "INCOME_TAX", "ROC", "LABOUR", "ENVIRONMENTAL", "OTHER",
];

const REG_LABELS: Record<string, string> = {
  GST: "GSTIN",
  TDS: "TAN",
  INCOME_TAX: "PAN",
  MCA: "CIN",
  ROC: "CIN",
  PF: "PF Code",
  ESIC: "ESIC Code",
  LABOUR: "Registration No.",
  ENVIRONMENTAL: "Consent No.",
  OTHER: "Registration No.",
};

const FY_OPTIONS = ["2024-25", "2025-26", "2026-27", "2027-28"];

const TEMPLATE_GROUP_ORDER: ComplianceTemplate["complianceType"][] = [
  "GST", "TDS", "PF", "ESIC", "MCA", "ROC", "INCOME_TAX", "LABOUR", "ENVIRONMENTAL", "OTHER",
];

const TYPE_BADGE_CLASSES: Record<string, string> = {
  GST: "bg-orange-100 text-orange-700",
  TDS: "bg-blue-100 text-blue-700",
  PF: "bg-purple-100 text-purple-700",
  ESIC: "bg-pink-100 text-pink-700",
  MCA: "bg-indigo-100 text-indigo-700",
  INCOME_TAX: "bg-green-100 text-green-700",
  ROC: "bg-cyan-100 text-cyan-700",
  LABOUR: "bg-yellow-100 text-yellow-700",
  ENVIRONMENTAL: "bg-emerald-100 text-emerald-700",
  OTHER: "bg-gray-100 text-gray-600",
};

const PRIORITY_BADGE_CLASSES: Record<string, string> = {
  low: "bg-gray-100 text-gray-600",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

const RECURRENCE_LABELS: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-Yearly",
  annually: "Annually",
  none: "One-time",
};

type UserOption = { id: string; name: string };

export default function NewCompliancePage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [complianceType, setComplianceType] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  // New fields
  const [period, setPeriod] = useState("");
  const [financialYear, setFinancialYear] = useState("");
  const [acknowledgementNumber, setAcknowledgementNumber] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [filedDate, setFiledDate] = useState("");
  const [paidDate, setPaidDate] = useState("");
  const [recurrenceType, setRecurrenceType] = useState("none");
  const [assignedToId, setAssignedToId] = useState("");

  // Template picker state
  const [templateSearch, setTemplateSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<ComplianceTemplate | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const regLabel = REG_LABELS[complianceType] || "Registration No.";

  const filteredTemplates = useMemo(() => {
    if (!templateSearch.trim()) return COMPLIANCE_TEMPLATES;
    const q = templateSearch.toLowerCase();
    return COMPLIANCE_TEMPLATES.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.complianceType.toLowerCase().includes(q) ||
        t.dueDateRule.toLowerCase().includes(q)
    );
  }, [templateSearch]);

  const groupedTemplates = useMemo(() => {
    const groups: Record<string, ComplianceTemplate[]> = {};
    for (const tpl of filteredTemplates) {
      if (!groups[tpl.complianceType]) groups[tpl.complianceType] = [];
      groups[tpl.complianceType].push(tpl);
    }
    return TEMPLATE_GROUP_ORDER.filter((t) => groups[t]?.length)
      .map((t) => ({ type: t, templates: groups[t]! }));
  }, [filteredTemplates]);

  const handleSelectTemplate = (tpl: ComplianceTemplate) => {
    setSelectedTemplate(tpl);
    setTitle(tpl.title);
    setComplianceType(tpl.complianceType);
    setPriority(tpl.priority);
    setRecurrenceType(tpl.recurrenceType);
    setDescription(tpl.description);
    setTemplatesOpen(false);
    toast.success(`Template applied: ${tpl.title}`);
  };

  const clearTemplate = () => {
    setSelectedTemplate(null);
  };

  useEffect(() => {
    fetch("/api/departments")
      .then((r) => r.json())
      .then((d) => setDepartments(d.departments ?? d))
      .catch(() => {});
    fetch("/api/users")
      .then((r) => r.json())
      .then((d) => setUserOptions(d.users ?? []))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !complianceType || !departmentId) {
      toast.error("Please fill in all required fields");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          complianceType,
          priority,
          dueDate: dueDate || null,
          departmentId,
          assignedToId: assignedToId === 'unassigned' ? null : assignedToId || null,
          period: period.trim() || null,
          financialYear: financialYear || null,
          acknowledgementNumber: acknowledgementNumber.trim() || null,
          registrationNumber: registrationNumber.trim() || null,
          amount: amount ? parseFloat(amount) : null,
          filedDate: filedDate || null,
          paidDate: paidDate || null,
          recurrenceType,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error);
      }

      const created = await res.json();
      toast.success("Compliance item created!");
      router.push(`/compliance/${created.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        href="/compliance"
        className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition"
      >
        <ArrowLeft className="size-4" />
        Back to Compliance
      </Link>

      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Add New Compliance</h1>
        <p className="text-sm text-ct-muted mt-1">Create a new compliance tracking item</p>
      </div>

      {/* ── Template Picker ──────────────────────────────────────── */}
      <Collapsible open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <div className="rounded-xl border border-ct-border bg-white shadow-card overflow-hidden">
          <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-ct-saffron" />
              <span className="text-sm font-semibold text-ct-navy">Quick Add from Template</span>
              {selectedTemplate && (
                <Badge
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 bg-ct-saffron/10 text-ct-saffron border-ct-saffron/20 font-medium"
                >
                  from template
                </Badge>
              )}
              {!selectedTemplate && (
                <span className="text-xs text-ct-muted">
                  {COMPLIANCE_TEMPLATES.length} templates available
                </span>
              )}
            </div>
            <ChevronDown
              className={`size-4 text-ct-muted transition-transform duration-200 ${templatesOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="border-t border-ct-border px-4 py-3 space-y-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-ct-muted" />
                <Input
                  placeholder="Search templates by name, type, or due date rule..."
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  className="pl-9 h-9 text-sm bg-muted/30 border-ct-border"
                />
                {templateSearch && (
                  <button
                    type="button"
                    onClick={() => setTemplateSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ct-muted hover:text-ct-navy transition"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              {/* Selected template indicator */}
              {selectedTemplate && (
                <div className="flex items-center gap-2 text-xs text-ct-muted bg-ct-saffron/5 border border-ct-saffron/20 rounded-lg px-3 py-2">
                  <Sparkles className="size-3.5 text-ct-saffron" />
                  <span>
                    Currently using: <strong className="text-ct-navy">{selectedTemplate.title}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={clearTemplate}
                    className="ml-auto text-ct-muted hover:text-red-500 transition"
                    aria-label="Clear template"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}

              {/* Template grid grouped by type */}
              <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1 custom-scrollbar">
                {groupedTemplates.length === 0 && (
                  <p className="text-sm text-ct-muted text-center py-6">No templates match your search.</p>
                )}
                {groupedTemplates.map(({ type, templates }) => (
                  <div key={type}>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ct-muted mb-2">
                      {type.replace("_", " ")}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {templates.map((tpl) => {
                        const isSelected = selectedTemplate?.id === tpl.id;
                        return (
                          <button
                            key={tpl.id}
                            type="button"
                            onClick={() => handleSelectTemplate(tpl)}
                            className={`rounded-lg bg-white border p-3 text-left transition-colors cursor-pointer ${
                              isSelected
                                ? "border-ct-saffron bg-ct-saffron/5"
                                : "border-ct-border hover:border-ct-saffron/50"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <span className="text-xs font-semibold text-ct-navy leading-tight line-clamp-1">
                                {tpl.title}
                              </span>
                              <span
                                className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${TYPE_BADGE_CLASSES[tpl.complianceType] ?? "bg-gray-100 text-gray-600"}`}
                              >
                                {tpl.complianceType.replace("_", " ")}
                              </span>
                            </div>
                            <p className="text-[11px] text-ct-muted leading-relaxed line-clamp-2 mb-2">
                              {tpl.description}
                            </p>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] text-ct-muted">
                                📅 {tpl.dueDateRule}
                              </span>
                              <span className="text-[9px] px-1.5 py-0 bg-ct-accent text-ct-teal font-medium rounded">
                                {RECURRENCE_LABELS[tpl.recurrenceType] ?? tpl.recurrenceType}
                              </span>
                              <span
                                className={`text-[9px] px-1.5 py-0 rounded font-medium ${PRIORITY_BADGE_CLASSES[tpl.priority] ?? "bg-gray-100 text-gray-600"}`}
                              >
                                {tpl.priority}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader>
          <CardTitle className="text-base text-ct-navy flex items-center gap-2">
            Compliance Details
            {selectedTemplate && (
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 bg-ct-saffron/10 text-ct-saffron border-ct-saffron/20 font-medium"
              >
                from template
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title" className="text-xs font-semibold text-ct-muted uppercase">
                Title <span className="text-red-500">*</span>
              </Label>
              <Input
                id="title"
                placeholder="e.g. GST Return Filing - August 2026"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description" className="text-xs font-semibold text-ct-muted uppercase">
                Description
              </Label>
              <Textarea
                id="description"
                placeholder="Details about this compliance item..."
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">
                  Compliance Type <span className="text-red-500">*</span>
                </Label>
                <Select value={complianceType} onValueChange={setComplianceType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPLIANCE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">
                  Department <span className="text-red-500">*</span>
                </Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Assign To</Label>
                <Select value={assignedToId} onValueChange={setAssignedToId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select team member" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {userOptions.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dueDate" className="text-xs font-semibold text-ct-muted uppercase">
                  Due Date
                </Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Period & Registration */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader>
          <CardTitle className="text-base text-ct-navy flex items-center gap-2">
            <Sparkles className="size-4 text-ct-teal" />
            Period, Filing & Registration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Period</Label>
                <Input
                  placeholder="e.g. June 2026, Q1 FY2026-27"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Financial Year</Label>
                <Select value={financialYear} onValueChange={setFinancialYear}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select FY" />
                  </SelectTrigger>
                  <SelectContent>
                    {FY_OPTIONS.map((fy) => (
                      <SelectItem key={fy} value={fy}>FY {fy}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Acknowledgement / ARN</Label>
                <Input
                  placeholder="ARN, SRN, ITR Ack Number"
                  value={acknowledgementNumber}
                  onChange={(e) => setAcknowledgementNumber(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">{regLabel}</Label>
                <Input
                  placeholder={`Enter ${regLabel}`}
                  value={registrationNumber}
                  onChange={(e) => setRegistrationNumber(e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment & Recurrence */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader>
          <CardTitle className="text-base text-ct-navy">Payment & Recurrence</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Amount (₹)</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Recurrence</Label>
                <Select value={recurrenceType} onValueChange={setRecurrenceType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (One-time)</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="half_yearly">Half-Yearly</SelectItem>
                    <SelectItem value="annually">Annually</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Filed Date</Label>
                <Input
                  type="date"
                  value={filedDate}
                  onChange={(e) => setFiledDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Paid Date</Label>
                <Input
                  type="date"
                  value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex gap-3">
        <Button
          type="button"
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          disabled={submitting}
          onClick={() => formRef.current?.requestSubmit()}
        >
          {submitting ? "Creating..." : "Create Compliance"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/compliance")}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}