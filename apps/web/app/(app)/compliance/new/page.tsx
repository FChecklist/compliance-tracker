"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Textarea, Select, Card, CardContent, CardHeader, CardTitle } from "@compliance/ui";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";

const TYPE_OPTIONS = [
  { label: "IT", value: "it" },
  { label: "Tax", value: "tax" },
  { label: "Legal", value: "legal" },
  { label: "Regulatory", value: "regulatory" },
  { label: "Operational", value: "operational" },
  { label: "Environmental", value: "environmental" },
  { label: "HR", value: "hr" },
  { label: "Finance", value: "finance" },
  { label: "Other", value: "other" },
];

const PRIORITY_OPTIONS = [
  { label: "Critical", value: "critical" },
  { label: "High", value: "high" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
];

// These will be populated from API in production
const DEPARTMENT_OPTIONS = [
  { label: "Finance Department", value: "dept-1" },
  { label: "Legal Department", value: "dept-2" },
  { label: "IT Department", value: "dept-3" },
  { label: "HR Department", value: "dept-4" },
];

const ASSIGNEE_OPTIONS = [
  { label: "John Doe", value: "user-1" },
  { label: "Jane Smith", value: "user-2" },
  { label: "Admin User", value: "user-3" },
];

export default function NewCompliancePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    title: "",
    description: "",
    compliance_type: "",
    priority: "medium",
    department_id: "",
    assignee_id: "",
    due_date: "",
  });

  const update = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => { const n = { ...prev }; delete n[field]; return n; });
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = "Title is required";
    else if (form.title.trim().length > 500) e.title = "Title must be under 500 characters";
    if (!form.compliance_type) e.compliance_type = "Compliance type is required";
    if (!form.priority) e.priority = "Priority is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim(),
        compliance_type: form.compliance_type,
        priority: form.priority,
      };
      if (form.department_id) body.department_id = form.department_id;
      if (form.assignee_id) body.assignee_id = form.assignee_id;
      if (form.due_date) body.due_date = new Date(form.due_date).toISOString();

      const res = await fetch("/api/compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create compliance item");
      }

      const data = await res.json();
      router.push(`/compliance/${data.compliance.id}`);
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : "Something went wrong" });
    }
    setSubmitting(false);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/compliance" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Compliance Item</h1>
          <p className="text-sm text-gray-500">Create a new compliance tracking item</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compliance Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {errors.submit && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{errors.submit}</div>
            )}

            {/* Title */}
            <Input
              label="Title *"
              placeholder="e.g., Annual IT Security Audit"
              value={form.title}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => update("title", e.target.value)}
              error={errors.title}
            />

            {/* Description */}
            <Textarea
              label="Description"
              placeholder="Describe the compliance requirement, scope, and key details..."
              value={form.description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => update("description", e.target.value)}
              rows={4}
            />

            {/* Type + Priority Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Compliance Type *"
                options={TYPE_OPTIONS}
                value={form.compliance_type}
                onChange={(v) => update("compliance_type", v)}
                placeholder="Select type..."
                error={errors.compliance_type}
              />
              <Select
                label="Priority *"
                options={PRIORITY_OPTIONS}
                value={form.priority}
                onChange={(v) => update("priority", v)}
                placeholder="Select priority..."
                error={errors.priority}
              />
            </div>

            {/* Department + Assignee Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Department"
                options={DEPARTMENT_OPTIONS}
                value={form.department_id}
                onChange={(v) => update("department_id", v)}
                placeholder="Select department..."
              />
              <Select
                label="Assignee"
                options={ASSIGNEE_OPTIONS}
                value={form.assignee_id}
                onChange={(v) => update("assignee_id", v)}
                placeholder="Select assignee..."
              />
            </div>

            {/* Due Date */}
            <Input
              label="Due Date"
              type="date"
              value={form.due_date}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => update("due_date", e.target.value)}
            />

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
              <Link href="/compliance">
                <Button type="button" variant="outline">Cancel</Button>
              </Link>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Compliance Item
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}