"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useUIStore } from "@/stores/ui-store";

// ─── Types ────────────────────────────────────────────────────────────────

type ComplianceItem = {
  id: string;
  title: string;
  description: string | null;
  compliance_type: string;
  status: string;
  priority: string;
  assignee_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};

type Pagination = {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
};

type ApiResponse = {
  success: boolean;
  data: ComplianceItem[];
  pagination: Pagination;
  error?: { code: string; message: string };
};

// ─── Constants ────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending: "bg-yellow-100 text-yellow-800",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
};

const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-green-500",
};

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "overdue", label: "Overdue" },
];

const PRIORITY_OPTIONS = [
  { value: "", label: "All Priorities" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const PAGE_SIZE = 15;
const DEBOUNCE_MS = 300;

function formatType(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatStatusLabel(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Skeleton ─────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="divide-y divide-gray-100">
        {Array.from({ length: 8 }).map((_, i) => (
          <tr key={i} className="flex items-center gap-4 px-4 py-3">
            <div className="h-4 w-1/4 rounded bg-gray-200" />
            <div className="h-4 w-20 rounded bg-gray-200" />
            <div className="h-4 w-24 rounded bg-gray-200" />
            <div className="h-4 w-16 rounded bg-gray-200" />
            <div className="h-4 w-28 rounded bg-gray-200" />
            <div className="h-4 w-20 rounded bg-gray-200" />
          </tr>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function CompliancePage() {
  // ── Filter / pagination state (filters persisted in Zustand UI store) ────
  const { activeFilters, setActiveFilter } = useUIStore();
  const search = (activeFilters.search as string) ?? "";
  const statusFilter = (activeFilters.status as string) ?? "";
  const priorityFilter = (activeFilters.priority as string) ?? "";
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  const updateSearch = (v: string) => setActiveFilter("search", v);
  const updateStatus = (v: string) => setActiveFilter("status", v);
  const updatePriority = (v: string) => setActiveFilter("priority", v);

  // ── Data state ─────────────────────────────────────────────────────────
  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Debounce search ────────────────────────────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(activeFilters.search as string ?? "");
      setPage(1); // reset to first page on new search
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeFilters.search]);

  // ── Reset page when filters change ─────────────────────────────────────
  useEffect(() => {
    setPage(1);
  }, [statusFilter, priorityFilter]);

  // ── Fetch compliance items ─────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter) params.set("status", statusFilter);
      if (priorityFilter) params.set("priority", priorityFilter);
      params.set("page", String(page));
      params.set("per_page", String(PAGE_SIZE));
      params.set("sort_by", "due_date");
      params.set("sort_order", "asc");

      const res = await fetch(`/api/compliance?${params.toString()}`);

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiResponse | null;
        throw new Error(
          body?.error?.message ?? `Request failed (${res.status})`
        );
      }

      const json = (await res.json()) as ApiResponse;

      if (!json.success) {
        throw new Error(json.error?.message ?? "Unexpected response");
      }

      setItems(json.data ?? []);
      setPagination(json.pagination ?? null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load compliance items"
      );
      setItems([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, priorityFilter, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Helpers ────────────────────────────────────────────────────────────
  const hasActiveFilters = debouncedSearch || statusFilter || priorityFilter;

  function clearFilters() {
    useUIStore.getState().clearFilters();
    setPage(1);
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance</h1>
          {pagination && (
            <p className="mt-1 text-sm text-gray-500">
              {pagination.total} item{pagination.total !== 1 ? "s" : ""} total
            </p>
          )}
        </div>
        <Link
          href="/compliance/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          New Compliance
        </Link>
      </div>

      {/* Filters bar */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center">
          {/* Search */}
          <div className="relative flex-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            >
              <path
                fillRule="evenodd"
                d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
                clipRule="evenodd"
              />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => updateSearch(e.target.value)}
              placeholder="Search compliance items..."
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => updateStatus(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {/* Priority filter */}
          <select
            value={priorityFilter}
            onChange={(e) => updatePriority(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {/* Clear filters */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="shrink-0 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Error state */}
        {error && !loading && (
          <div className="flex items-center gap-3 border-b border-gray-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4 shrink-0"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                clipRule="evenodd"
              />
            </svg>
            <span>{error}</span>
            <button
              onClick={fetchData}
              className="ml-auto shrink-0 font-medium underline underline-offset-2 hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <TableSkeleton />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="mb-3 h-10 w-10 text-gray-300"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-sm font-medium text-gray-500">
              No compliance items found
            </p>
            {!hasActiveFilters && (
              <Link
                href="/compliance/new"
                className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Create your first compliance item
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Title
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Priority
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Assignee
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Due Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="transition-colors hover:bg-gray-50"
                  >
                    {/* Title */}
                    <td className="px-4 py-3">
                      <Link
                        href={`/compliance/${item.id}`}
                        className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                      >
                        {item.title}
                      </Link>
                    </td>

                    {/* Type badge */}
                    <td className="px-4 py-3">
                      <span className="inline-block rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {formatType(item.compliance_type)}
                      </span>
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[item.status] ?? "bg-gray-100 text-gray-600"}`}
                      >
                        {formatStatusLabel(item.status)}
                      </span>
                    </td>

                    {/* Priority dot + label */}
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${PRIORITY_DOT[item.priority] ?? "bg-gray-400"}`}
                        />
                        <span className="text-gray-700">
                          {item.priority.charAt(0).toUpperCase() +
                            item.priority.slice(1)}
                        </span>
                      </span>
                    </td>

                    {/* Assignee */}
                    <td className="px-4 py-3 text-gray-500">
                      {item.assignee_id ? (
                        <span className="font-mono text-xs">
                          {item.assignee_id.slice(0, 8)}…
                        </span>
                      ) : (
                        <span className="text-gray-300">Unassigned</span>
                      )}
                    </td>

                    {/* Due Date */}
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {formatDate(item.due_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.total_pages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
            <p className="text-sm text-gray-500">
              Page {pagination.page} of {pagination.total_pages}
              <span className="mx-1.5 text-gray-300" aria-hidden="true">
                ·
              </span>
              {(pagination.page - 1) * pagination.per_page + 1}–
              {Math.min(
                pagination.page * pagination.per_page,
                pagination.total
              )}{" "}
              of {pagination.total}
            </p>
            <div className="flex items-center gap-2">
              <button
                disabled={!pagination.has_prev}
                onClick={() => setPage((p) => p - 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
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
                Previous
              </button>
              <button
                disabled={!pagination.has_next}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Next
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
