"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────

type ComplianceItem = {
  id: string;
  title: string;
  description: string | null;
  compliance_type: string;
  status: string;
  priority: string;
  department_id: string | null;
  assignee_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  org_id: string;
  unique_url_slug: string;
};

type Department = { id: string; name: string };
type User = { id: string; email: string; full_name: string | null };

// ─── Constants ────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending: "bg-yellow-100 text-yellow-800",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
};

const PRIORITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-green-100 text-green-800",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  overdue: "Overdue",
};

const PRIORITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["pending", "in_progress"],
  pending: ["in_progress", "completed", "overdue"],
  in_progress: ["completed", "pending", "overdue"],
  completed: ["in_progress", "pending"],
  overdue: ["in_progress", "pending", "completed"],
};

const STATUS_ACTION_LABEL: Record<string, Record<string, string>> = {
  pending: { in_progress: "Start Work", completed: "Complete", overdue: "Mark Overdue" },
  in_progress: { completed: "Complete", pending: "Revert to Pending", overdue: "Mark Overdue" },
  completed: { in_progress: "Reopen", pending: "Revert to Pending" },
  overdue: { in_progress: "Resume Work", pending: "Revert to Pending", completed: "Complete" },
  draft: { pending: "Submit", in_progress: "Start Work" },
};

const STATUS_ACTION_STYLE: Record<string, string> = {
  pending: "bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-blue-600",
  in_progress: "bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-blue-600",
  completed: "bg-green-600 text-white hover:bg-green-700 focus-visible:outline-green-600",
  overdue: "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatType(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string | null): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isOverdue(item: ComplianceItem): boolean {
  if (!item.due_date || item.status === "completed") return false;
  return new Date(item.due_date) < new Date();
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6">
      {/* Back link */}
      <div className="h-4 w-24 rounded bg-gray-200" />

      {/* Title row */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="h-6 w-20 rounded-full bg-gray-200" />
          <div className="h-6 w-16 rounded-full bg-gray-200" />
        </div>
        <div className="h-8 w-3/5 rounded bg-gray-200" />
      </div>

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content skeleton */}
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 lg:col-span-2">
          <div className="h-4 w-32 rounded bg-gray-200" />
          <div className="space-y-2">
            <div className="h-4 w-full rounded bg-gray-200" />
            <div className="h-4 w-full rounded bg-gray-200" />
            <div className="h-4 w-2/3 rounded bg-gray-200" />
          </div>
          <div className="pt-4">
            <div className="h-4 w-28 rounded bg-gray-200" />
            <div className="mt-3 flex gap-3">
              <div className="h-9 w-28 rounded-lg bg-gray-200" />
              <div className="h-9 w-28 rounded-lg bg-gray-200" />
            </div>
          </div>
        </div>

        {/* Sidebar skeleton */}
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="space-y-4 pt-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <div className="h-3 w-16 rounded bg-gray-200" />
                <div className="h-4 w-32 rounded bg-gray-200" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page Component ───────────────────────────────────────────────────────

export default function ComplianceDetailPage() {
  const { id } = useParams<{ id: string }>();

  // ── Data state ─────────────────────────────────────────────────────────
  const [item, setItem] = useState<ComplianceItem | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Status change state ────────────────────────────────────────────────
  const [changingStatus, setChangingStatus] = useState<string | null>(null);
  const [showReasonDialog, setShowReasonDialog] = useState(false);
  const [pendingTargetStatus, setPendingTargetStatus] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [statusError, setStatusError] = useState<string | null>(null);

  // ── Fetch compliance item + reference data ─────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const [itemRes, deptRes, usersRes] = await Promise.all([
        fetch(`/api/compliance/${id}`),
        fetch("/api/departments"),
        fetch("/api/users"),
      ]);

      // Handle compliance item response
      if (itemRes.status === 404) {
        setNotFound(true);
        return;
      }
      if (!itemRes.ok) {
        const body = (await itemRes.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `Failed to load compliance item (${itemRes.status})`);
      }

      const itemJson = (await itemRes.json()) as { success: boolean; data: ComplianceItem; error?: { message: string } };
      if (!itemJson.success) {
        throw new Error(itemJson.error?.message ?? "Unexpected response");
      }

      setItem(itemJson.data);

      // Load reference data (best-effort)
      const deptJson = (await deptRes.json().catch(() => null)) as { departments?: Department[] } | null;
      if (deptJson?.departments) setDepartments(deptJson.departments);

      const usersJson = (await usersRes.json().catch(() => null)) as { users?: User[] } | null;
      if (usersJson?.users) setUsers(usersJson.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load compliance item");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Status change handler ──────────────────────────────────────────────
  function handleStatusClick(targetStatus: string) {
    setPendingTargetStatus(targetStatus);
    setReasonText("");
    setStatusError(null);
    setShowReasonDialog(true);
  }

  async function confirmStatusChange() {
    if (!pendingTargetStatus || !item) return;
    setChangingStatus(pendingTargetStatus);
    setStatusError(null);

    try {
      const res = await fetch(`/api/compliance/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_status: pendingTargetStatus,
          ...(reasonText.trim() ? { reason: reasonText.trim() } : {}),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `Status change failed (${res.status})`);
      }

      const json = (await res.json()) as { success: boolean; data: ComplianceItem; error?: { message: string } };
      if (!json.success) {
        throw new Error(json.error?.message ?? "Unexpected response");
      }

      setItem(json.data);
      setShowReasonDialog(false);
      setPendingTargetStatus(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to change status");
    } finally {
      setChangingStatus(null);
    }
  }

  function cancelStatusChange() {
    setShowReasonDialog(false);
    setPendingTargetStatus(null);
    setReasonText("");
    setStatusError(null);
  }

  // ── Resolved names ─────────────────────────────────────────────────────
  const departmentName = item?.department_id
    ? departments.find((d) => d.id === item.department_id)?.name ?? null
    : null;

  const assignee = item?.assignee_id
    ? users.find((u) => u.id === item.assignee_id)
    : null;

  // ── Allowed transitions ────────────────────────────────────────────────
  const allowedTransitions = item ? (STATUS_TRANSITIONS[item.status] ?? []) : [];

  // ── Render: Loading ────────────────────────────────────────────────────
  if (loading) return <Skeleton />;

  // ── Render: Not found ──────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="mb-4 h-12 w-12 text-gray-300"
        >
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            clipRule="evenodd"
          />
        </svg>
        <h2 className="text-lg font-semibold text-gray-900">Compliance not found</h2>
        <p className="mt-1 text-sm text-gray-500">
          The compliance item you&apos;re looking for doesn&apos;t exist or has been removed.
        </p>
        <Link
          href="/compliance"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path
              fillRule="evenodd"
              d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z"
              clipRule="evenodd"
            />
          </svg>
          Back to Compliance
        </Link>
      </div>
    );
  }

  // ── Render: Error ──────────────────────────────────────────────────────
  if (error || !item) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="mb-4 h-12 w-12 text-red-400"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            clipRule="evenodd"
          />
        </svg>
        <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
        <p className="mt-1 text-sm text-gray-500">{error ?? "Failed to load compliance item."}</p>
        <button
          onClick={fetchData}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path
              fillRule="evenodd"
              d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H4.598a.75.75 0 0 0-.75.75v3.634a.75.75 0 0 0 1.5 0v-2.033l.312.311a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm-7.948-3.442a5.5 5.5 0 0 1 9.201-2.466l.312.311h-2.433a.75.75 0 0 0 0 1.5h3.634a.75.75 0 0 0 .75-.75V2.598a.75.75 0 0 0-1.5 0v2.033l-.312-.311a7 7 0 0 0-11.712 3.138.75.75 0 0 0 1.449.39Z"
              clipRule="evenodd"
            />
          </svg>
          Try Again
        </button>
        <Link
          href="/compliance"
          className="mt-2 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
        >
          Back to Compliance
        </Link>
      </div>
    );
  }

  // ── Render: Detail ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/compliance"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
        >
          <path
            fillRule="evenodd"
            d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z"
            clipRule="evenodd"
          />
        </svg>
        Back to Compliance
      </Link>

      {/* Header: badges + title */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[item.status] ?? "bg-gray-100 text-gray-600"}`}
          >
            {STATUS_LABEL[item.status] ?? item.status}
          </span>
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${PRIORITY_BADGE[item.priority] ?? "bg-gray-100 text-gray-600"}`}
          >
            {PRIORITY_LABEL[item.priority] ?? item.priority}
          </span>
          <span className="inline-block rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {formatType(item.compliance_type)}
          </span>
          {isOverdue(item) && (
            <span className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
              Overdue
            </span>
          )}
        </div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{item.title}</h1>
      </div>

      {/* Two-column layout: main + sidebar */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Main content ──────────────────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-2">
          {/* Description card */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Description
            </h2>
            {item.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                {item.description}
              </p>
            ) : (
              <p className="text-sm italic text-gray-400">No description provided.</p>
            )}
          </div>

          {/* Status change actions card */}
          {allowedTransitions.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Actions
              </h2>
              <div className="flex flex-wrap gap-3">
                {allowedTransitions.map((targetStatus) => {
                  const label =
                    STATUS_ACTION_LABEL[item.status]?.[targetStatus] ??
                    STATUS_LABEL[targetStatus] ??
                    targetStatus;
                  const isChanging = changingStatus === targetStatus;

                  return (
                    <button
                      key={targetStatus}
                      disabled={isChanging}
                      onClick={() => handleStatusClick(targetStatus)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${STATUS_ACTION_STYLE[targetStatus] ?? "bg-gray-600 text-white hover:bg-gray-700 focus-visible:outline-gray-600"}`}
                    >
                      {isChanging && (
                        <svg
                          className="h-4 w-4 animate-spin"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
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
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4Z"
                          />
                        </svg>
                      )}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Sidebar: metadata ─────────────────────────────────────────── */}
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Details
            </h2>
            <dl className="space-y-4">
              {/* Due date */}
              <div>
                <dt className="text-xs font-medium text-gray-400">Due Date</dt>
                <dd className="mt-0.5 text-sm font-medium text-gray-900">
                  {formatDate(item.due_date)}
                </dd>
                {isOverdue(item) && (
                  <dd className="mt-0.5 text-xs font-medium text-red-600">Past due</dd>
                )}
              </div>

              {/* Department */}
              <div>
                <dt className="text-xs font-medium text-gray-400">Department</dt>
                <dd className="mt-0.5 text-sm font-medium text-gray-900">
                  {departmentName ?? (
                    <span className="text-gray-400">Unassigned</span>
                  )}
                </dd>
              </div>

              {/* Assignee */}
              <div>
                <dt className="text-xs font-medium text-gray-400">Assignee</dt>
                <dd className="mt-0.5 text-sm font-medium text-gray-900">
                  {assignee ? (
                    <span>{assignee.full_name || assignee.email}</span>
                  ) : (
                    <span className="text-gray-400">Unassigned</span>
                  )}
                </dd>
              </div>

              {/* Created */}
              <div>
                <dt className="text-xs font-medium text-gray-400">Created</dt>
                <dd className="mt-0.5 text-sm text-gray-700">
                  {formatDateTime(item.created_at)}
                </dd>
              </div>

              {/* Updated */}
              <div>
                <dt className="text-xs font-medium text-gray-400">Last Updated</dt>
                <dd className="mt-0.5 text-sm text-gray-700">
                  {formatDateTime(item.updated_at)}
                </dd>
              </div>

              {/* Slug */}
              <div>
                <dt className="text-xs font-medium text-gray-400">Slug</dt>
                <dd className="mt-0.5 truncate font-mono text-xs text-gray-500">
                  {item.unique_url_slug}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {/* ── Reason dialog (modal) ──────────────────────────────────────── */}
      {showReasonDialog && pendingTargetStatus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              Change Status to &ldquo;{STATUS_LABEL[pendingTargetStatus] ?? pendingTargetStatus}&rdquo;
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Optionally add a reason for this status change.
            </p>

            {statusError && (
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {statusError}
              </div>
            )}

            <textarea
              rows={3}
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="Reason for status change (optional)..."
              className="mt-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />

            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={cancelStatusChange}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmStatusChange}
                disabled={changingStatus !== null}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${STATUS_ACTION_STYLE[pendingTargetStatus] ?? "bg-gray-600 hover:bg-gray-700 focus-visible:outline-gray-600"}`}
              >
                {changingStatus === pendingTargetStatus && (
                  <svg
                    className="h-4 w-4 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
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
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4Z"
                    />
                  </svg>
                )}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}