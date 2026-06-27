"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";

// ── Constants ────────────────────────────────────────────────────────────

const COMPLIANCE_TYPES = [
  { value: "it", label: "IT" },
  { value: "tax", label: "Tax" },
  { value: "legal", label: "Legal" },
  { value: "regulatory", label: "Regulatory" },
  { value: "operational", label: "Operational" },
  { value: "environmental", label: "Environmental" },
  { value: "hr", label: "HR" },
  { value: "finance", label: "Finance" },
  { value: "other", label: "Other" },
] as const;

const PRIORITIES = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;

// ── Client-side validation schema (mirrors server CreateComplianceSchema) ─

const FormSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(300, "Title must be at most 300 characters"),
  description: z.string().optional(),
  compliance_type: z.enum(
    ["it", "tax", "legal", "regulatory", "operational", "environmental", "hr", "finance", "other"],
    { message: "Select a valid compliance type" },
  ),
  priority: z.enum(["critical", "high", "medium", "low"], {
    message: "Select a valid priority",
  }),
  department_id: z.string().uuid({ message: "Select a valid department" }).nullable().optional(),
  assignee_id: z.string().uuid({ message: "Select a valid assignee" }).nullable().optional(),
  due_date: z.string().nullable().optional(),
});

type FormErrors = Partial<Record<keyof z.infer<typeof FormSchema>, string>>;

interface Department {
  id: string;
  name: string;
}

interface User {
  id: string;
  full_name: string;
  email: string;
}

// ── Component ────────────────────────────────────────────────────────────

export default function NewCompliancePage() {
  const router = useRouter();

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [complianceType, setComplianceType] = useState("");
  const [priority, setPriority] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");

  // Async state
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);

  // ── Fetch departments & users ────────────────────────────────────────

  const fetchReferenceData = useCallback(async () => {
    try {
      const [deptRes, userRes] = await Promise.all([
        fetch("/api/departments"),
        fetch("/api/users"),
      ]);

      if (deptRes.ok) {
        const deptJson = await deptRes.json();
        if (deptJson.success) setDepartments(deptJson.data);
      }

      if (userRes.ok) {
        const userJson = await userRes.json();
        if (userJson.success) setUsers(userJson.data);
      }
    } catch {
      // Non-critical — user can still type/submit without these lookups
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReferenceData();
  }, [fetchReferenceData]);

  // ── Validation ───────────────────────────────────────────────────────

  function validate(): boolean {
    const result = FormSchema.safeParse({
      title,
      description: description || undefined,
      compliance_type: complianceType,
      priority,
      department_id: departmentId || null,
      assignee_id: assigneeId || null,
      due_date: dueDate || null,
    });

    if (result.success) {
      setErrors({});
      return true;
    }

    const fieldErrors: FormErrors = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof FormErrors;
      if (!fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    setErrors(fieldErrors);
    return false;
  }

  // ── Submit ───────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);

    if (!validate()) return;

    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        title,
        compliance_type: complianceType,
        priority,
      };

      if (description) body.description = description;
      if (departmentId) body.department_id = departmentId;
      if (assigneeId) body.assignee_id = assigneeId;
      if (dueDate) body.due_date = dueDate;

      const res = await fetch("/api/compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (!res.ok) {
        const message =
          json?.error?.message || "Something went wrong. Please try again.";
        setApiError(message);
        return;
      }

      router.push("/compliance");
    } catch {
      setApiError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Shared input classes ─────────────────────────────────────────────

  const inputBase =
    "w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900 transition-colors placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-0";
  const inputNormal = `${inputBase} border-gray-300 focus:border-blue-500 focus:ring-blue-500/20`;
  const inputError = `${inputBase} border-red-300 focus:border-red-500 focus:ring-red-500/20`;

  function fieldError(field: keyof FormErrors) {
    return errors[field] || null;
  }

  function inputClasses(field: keyof FormErrors) {
    return fieldError(field) ? inputError : inputNormal;
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          Create Compliance
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Add a new compliance item to your organisation.
        </p>
      </div>

      {/* Form card */}
      <form
        onSubmit={handleSubmit}
        noValidate
        className="rounded-xl border border-gray-200 bg-white shadow-sm"
      >
        <div className="space-y-6 p-6">
          {/* API-level error banner */}
          {apiError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p className="font-medium">Failed to create compliance</p>
              <p className="mt-0.5">{apiError}</p>
            </div>
          )}

          {/* Title */}
          <div>
            <label
              htmlFor="title"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="title"
              type="text"
              maxLength={300}
              required
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
              }}
              placeholder="e.g. Q4 GST Filing"
              className={inputClasses("title")}
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? "title-error" : undefined}
            />
            <div className="mt-1.5 flex items-center justify-between">
              {errors.title ? (
                <p id="title-error" className="text-xs text-red-600">
                  {errors.title}
                </p>
              ) : (
                <span />
              )}
              <span className="text-xs text-gray-400">
                {title.length}/300
              </span>
            </div>
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="description"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Description
            </label>
            <textarea
              id="description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details about this compliance item..."
              className={`${inputClasses("description")} resize-y`}
              aria-invalid={!!errors.description}
              aria-describedby={errors.description ? "description-error" : undefined}
            />
            {errors.description && (
              <p id="description-error" className="mt-1 text-xs text-red-600">
                {errors.description}
              </p>
            )}
          </div>

          {/* Compliance Type + Priority (2-col on lg) */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Compliance Type */}
            <div>
              <label
                htmlFor="compliance_type"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Compliance Type <span className="text-red-500">*</span>
              </label>
              <select
                id="compliance_type"
                value={complianceType}
                onChange={(e) => {
                  setComplianceType(e.target.value);
                  if (errors.compliance_type)
                    setErrors((prev) => ({
                      ...prev,
                      compliance_type: undefined,
                    }));
                }}
                className={inputClasses("compliance_type")}
                aria-invalid={!!errors.compliance_type}
                aria-describedby={
                  errors.compliance_type ? "type-error" : undefined
                }
              >
                <option value="" disabled>
                  Select type
                </option>
                {COMPLIANCE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {errors.compliance_type && (
                <p id="type-error" className="mt-1 text-xs text-red-600">
                  {errors.compliance_type}
                </p>
              )}
            </div>

            {/* Priority */}
            <div>
              <label
                htmlFor="priority"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Priority <span className="text-red-500">*</span>
              </label>
              <select
                id="priority"
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value);
                  if (errors.priority)
                    setErrors((prev) => ({ ...prev, priority: undefined }));
                }}
                className={inputClasses("priority")}
                aria-invalid={!!errors.priority}
                aria-describedby={
                  errors.priority ? "priority-error" : undefined
                }
              >
                <option value="" disabled>
                  Select priority
                </option>
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              {errors.priority && (
                <p id="priority-error" className="mt-1 text-xs text-red-600">
                  {errors.priority}
                </p>
              )}
            </div>
          </div>

          {/* Department + Assignee (2-col on lg) */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Department */}
            <div>
              <label
                htmlFor="department_id"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Department
              </label>
              <select
                id="department_id"
                value={departmentId}
                onChange={(e) => {
                  setDepartmentId(e.target.value);
                  if (errors.department_id)
                    setErrors((prev) => ({
                      ...prev,
                      department_id: undefined,
                    }));
                }}
                className={inputClasses("department_id")}
                disabled={dataLoading}
                aria-invalid={!!errors.department_id}
                aria-describedby={
                  errors.department_id ? "dept-error" : undefined
                }
              >
                <option value="">
                  {dataLoading ? "Loading..." : "None"}
                </option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {errors.department_id && (
                <p id="dept-error" className="mt-1 text-xs text-red-600">
                  {errors.department_id}
                </p>
              )}
            </div>

            {/* Assignee */}
            <div>
              <label
                htmlFor="assignee_id"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Assignee
              </label>
              <select
                id="assignee_id"
                value={assigneeId}
                onChange={(e) => {
                  setAssigneeId(e.target.value);
                  if (errors.assignee_id)
                    setErrors((prev) => ({
                      ...prev,
                      assignee_id: undefined,
                    }));
                }}
                className={inputClasses("assignee_id")}
                disabled={dataLoading}
                aria-invalid={!!errors.assignee_id}
                aria-describedby={
                  errors.assignee_id ? "assignee-error" : undefined
                }
              >
                <option value="">
                  {dataLoading ? "Loading..." : "Unassigned"}
                </option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
              {errors.assignee_id && (
                <p id="assignee-error" className="mt-1 text-xs text-red-600">
                  {errors.assignee_id}
                </p>
              )}
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label
              htmlFor="due_date"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Due Date
            </label>
            <input
              id="due_date"
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                if (errors.due_date)
                  setErrors((prev) => ({ ...prev, due_date: undefined }));
              }}
              className={`${inputClasses("due_date")} max-w-xs`}
              aria-invalid={!!errors.due_date}
              aria-describedby={
                errors.due_date ? "due-error" : undefined
              }
            />
            {errors.due_date && (
              <p id="due-error" className="mt-1 text-xs text-red-600">
                {errors.due_date}
              </p>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50/60 px-6 py-4 rounded-b-xl">
          <a
            href="/compliance"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-1"
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && (
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
            )}
            {submitting ? "Creating..." : "Create Compliance"}
          </button>
        </div>
      </form>
    </div>
  );
}