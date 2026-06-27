"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { StatusBadge, Button, SearchInput, EmptyState, Select } from "@compliance/ui";
import { Plus, Filter, ChevronLeft, ChevronRight, FileText } from "lucide-react";

type ComplianceRow = {
  id: string;
  title: string;
  description: string;
  compliance_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  unique_url_slug: string;
  assignee_id: string | null;
  department_id: string | null;
  assignee_name: string | null;
  department_name: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_OPTIONS = [
  { label: "All Statuses", value: "" },
  { label: "Draft", value: "draft" },
  { label: "Pending", value: "pending" },
  { label: "In Progress", value: "in_progress" },
  { label: "Completed", value: "completed" },
  { label: "Overdue", value: "overdue" },
];

const PRIORITY_OPTIONS = [
  { label: "All Priorities", value: "" },
  { label: "Critical", value: "critical" },
  { label: "High", value: "high" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
];

const TYPE_OPTIONS = [
  { label: "All Types", value: "" },
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

export default function CompliancePage() {
  const [rows, setRows] = useState<ComplianceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [complianceType, setComplianceType] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  const fetchCompliance = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: "25", sort_by: "due_date", sort_order: "asc" });
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (priority) params.set("priority", priority);
      if (complianceType) params.set("compliance_type", complianceType);
      const res = await fetch(`/api/compliance?${params}`);
      const data = await res.json();
      setRows(data.compliance ?? []);
      setTotalPages(data.pagination?.total_pages ?? 1);
      setTotal(data.pagination?.total ?? 0);
    } catch {}
    setLoading(false);
  }, [search, status, priority, complianceType, page]);

  useEffect(() => { fetchCompliance(); }, [fetchCompliance]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance</h1>
          <p className="text-sm text-gray-500">{total} total items</p>
        </div>
        <Link href="/compliance/new">
          <Button><Plus className="w-4 h-4 mr-2" /> New Compliance</Button>
        </Link>
      </div>

      {/* Search + Filter Toggle */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search compliance items..." />
        </div>
        <Button variant="outline" onClick={() => setShowFilters(!showFilters)}>
          <Filter className="w-4 h-4 mr-2" /> Filters {showFilters ? "▲" : "▼"}
        </Button>
      </div>

      {/* Filter Row */}
      {showFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <Select options={STATUS_OPTIONS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} placeholder="All Statuses" />
          <Select options={PRIORITY_OPTIONS} value={priority} onChange={(v) => { setPriority(v); setPage(1); }} placeholder="All Priorities" />
          <Select options={TYPE_OPTIONS} value={complianceType} onChange={(v) => { setComplianceType(v); setPage(1); }} placeholder="All Types" />
        </div>
      )}

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm font-medium text-blue-700">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FileText className="w-8 h-8" />}
            title="No compliance items found"
            description="Create your first compliance item or adjust your filters."
            action={
              <Link href="/compliance/new">
                <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Create</Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-10 px-3 py-3">
                    <input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} className="rounded border-gray-300" />
                  </th>
                  <th className="text-left px-3 py-3 font-medium text-gray-500">Title</th>
                  <th className="text-left px-3 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-3 py-3 font-medium text-gray-500">Priority</th>
                  <th className="text-left px-3 py-3 font-medium text-gray-500">Type</th>
                  <th className="text-left px-3 py-3 font-medium text-gray-500">Assignee</th>
                  <th className="text-left px-3 py-3 font-medium text-gray-500">Department</th>
                  <th className="text-left px-3 py-3 font-medium text-gray-500">Due Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} className="rounded border-gray-300" />
                    </td>
                    <td className="px-3 py-2.5 max-w-[280px]">
                      <Link href={`/compliance/${item.id}`} className="text-blue-600 hover:text-blue-800 font-medium hover:underline line-clamp-1">
                        {item.title}
                      </Link>
                      {item.description && (
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{item.description}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge status={item.status} /></td>
                    <td className="px-3 py-2.5"><StatusBadge status={item.priority} /></td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded capitalize">
                        {item.compliance_type.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs">{item.assignee_name ?? "—"}</td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs">{item.department_name ?? "—"}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">
                      {item.due_date ? new Date(item.due_date).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="w-4 h-4" /> Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}