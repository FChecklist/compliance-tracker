"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { format } from "date-fns";
import {
  Plus,
  Search,
  Filter,
  X,
  ChevronLeft,
  ChevronRight,
  Eye,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ComplianceItem = {
  id: string;
  title: string;
  complianceType: string;
  status: string;
  priority: string;
  dueDate: string | null;
  period: string | null;
  acknowledgementNumber: string | null;
  department: { name: string };
  assignedTo: { name: string; avatarUrl: string | null } | null;
};

const STATUS_BADGE: Record<string, string> = {
  overdue: "bg-red-100 text-red-700",
  pending: "bg-amber-100 text-amber-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  draft: "bg-purple-100 text-purple-700",
  not_applicable: "bg-gray-100 text-gray-600",
};

const STATUS_LABELS: Record<string, string> = {
  overdue: "Overdue",
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  draft: "Draft",
  not_applicable: "N/A",
};

const PRIORITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-emerald-100 text-emerald-700",
};

// Pure, unit-testable derivation functions for the URL-driven pagination
// fix (GAP-COMPLIANCE-PAGINATION-REVERT) -- see route.test.ts for coverage.
export function parsePageParam(searchParams: URLSearchParams): number {
  return Math.max(1, Number(searchParams.get("page")) || 1);
}

export function buildPageUrl(pathname: string, searchParams: URLSearchParams, nextPage: number): string {
  const params = new URLSearchParams(searchParams.toString());
  if (nextPage <= 1) params.delete("page"); else params.set("page", String(nextPage));
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function ComplianceRegisterView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [total, setTotal] = useState(0);
  // GAP-COMPLIANCE-PAGINATION-REVERT (OCID-050 live re-verification,
  // UMR-20260805-002929-5560, UMR-20260804-234032-146e,
  // UMR-20260802-165606-4413): `page` used to be a plain useState(1) --
  // live-confirmed (real Playwright clicks, 3 independent trials) that
  // clicking to page 2+ correctly fetched the new page's data, then within
  // ~2-3.5s an unprompted request for page=1 fired and the UI silently
  // reverted, so a real user could never actually browse a large compliance
  // register past page 1. The `?page=N` URL param was also previously
  // inert -- pagination was pure client state, invisible to any URL-based
  // sweep. Deriving `page` from the URL via useSearchParams (this repo's
  // own established pattern, see reports/page.tsx's CustomReportsSection)
  // fixes both real issues at once: the URL becomes the source of truth, so
  // a transient re-render/remount re-derives page 2 from the URL instead of
  // silently falling back to a hardcoded initial value of 1, and the page
  // number is now a real, shareable/bookmarkable/back-button-safe URL param.
  const page = parsePageParam(searchParams);
  const setPage = useCallback((next: number) => {
    router.replace(buildPageUrl(pathname, searchParams, next), { scroll: false });
  }, [router, pathname, searchParams]);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limit = 20;
  const totalPages = Math.ceil(total / limit);

  const updateFilter = (updater: () => void) => {
    setLoading(true);
    updater();
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 350);
  };

  useEffect(() => {
    fetch("/api/departments")
      .then((r) => r.json())
      .then((d) => {
        // UMR-20260802-165606-4413: a backend failure here returns
        // `{ error: "..." }` (see src/app/api/departments/route.ts's catch
        // block), which is an object, not an array. `d.departments ?? d`
        // used to fall back to that whole error object when `d.departments`
        // was undefined, so `departments` state ended up holding
        // `{ error: "..." }` instead of an array -- and the `.map()` below
        // (department filter options) threw a client-side TypeError that
        // crashed the entire Compliance Register / Pendency View page.
        // A malformed or missing `departments` array must never reach
        // `.map()`; any non-array response degrades to an empty list plus a
        // visible, real error toast instead of a page-level crash.
        if (Array.isArray(d?.departments)) {
          setDepartments(d.departments);
        } else {
          setDepartments([]);
          toast.error("Couldn't load departments. The department filter is unavailable for now.");
        }
      })
      .catch(() => {
        setDepartments([]);
        toast.error("Couldn't load departments. The department filter is unavailable for now.");
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    params.set("page", page.toString());
    params.set("limit", limit.toString());
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (deptFilter !== "all") params.set("departmentId", deptFilter);
    if (typeFilter !== "all") params.set("complianceType", typeFilter);

    fetch(`/api/compliance?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setItems(d.compliance ?? []);
          setTotal(d.total ?? 0);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [page, debouncedSearch, statusFilter, deptFilter, typeFilter]);

  const hasActiveFilters = statusFilter !== "all" || deptFilter !== "all" || typeFilter !== "all";

  const exportCSV = async () => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '1000');
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (deptFilter !== 'all') params.set('departmentId', deptFilter);
      if (typeFilter !== 'all') params.set('complianceType', typeFilter);

      const res = await fetch(`/api/compliance?${params}`);
      const data = await res.json();
      const exportItems = data.compliance ?? [];

      const headers = ['Title','Type','Status','Priority','Department','Assigned To','Due Date','Period','ARN'];
      const rows = exportItems.map((item: ComplianceItem) => [
        `"${item.title}"`,
        item.complianceType,
        item.status,
        item.priority,
        `"${item.department.name}"`,
        item.assignedTo?.name ?? '',
        item.dueDate ? new Date(item.dueDate).toLocaleDateString('en-IN') : '',
        item.period ?? '',
        item.acknowledgementNumber ?? '',
      ].join(','));

      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `compliance-export-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      // Fire-and-forget: feeds the bulk-export Tier-1 monitor
      // (src/app/api/compliance/export-event/route.ts). Never blocks the
      // download on this.
      fetch('/api/compliance/export-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: exportItems.length }),
      }).catch(() => {});
    } catch {
      toast.error('Export failed');
    }
  };

  const clearFilters = () => {
    setStatusFilter("all");
    setDeptFilter("all");
    setTypeFilter("all");
    setPage(1);
  };

  const COMPLIANCE_TYPES = [
    "GST", "TDS", "MCA", "PF", "ESIC", "INCOME_TAX", "ROC", "LABOUR", "ENVIRONMENTAL", "OTHER",
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Compliance Register</h1>
          <p className="text-sm text-ct-muted mt-1">
            {total} compliance item{total !== 1 ? "s" : ""} tracked
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV} className="gap-2">
            <Download className="size-4" />
            Export CSV
          </Button>
          <Button
            asChild
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          >
            <Link href="/compliance/new">
              <Plus className="size-4 mr-2" />
              Add Compliance
            </Link>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="rounded-xl shadow-card bg-white p-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 size-4 text-ct-muted" />
            <Input
              placeholder="Search title..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={(v) => updateFilter(() => setStatusFilter(v))}>
              <SelectTrigger className="w-[130px] h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="not_applicable">N/A</SelectItem>
              </SelectContent>
            </Select>
            <Select value={deptFilter} onValueChange={(v) => updateFilter(() => setDeptFilter(v))}>
              <SelectTrigger className="w-[150px] h-9">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={(v) => updateFilter(() => setTypeFilter(v))}>
              <SelectTrigger className="w-[130px] h-9">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {COMPLIANCE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="h-9 px-2" onClick={clearFilters}>
                <X className="size-3.5 mr-1" /> Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="rounded-xl shadow-card bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold text-ct-navy">Title</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden md:table-cell">Type</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden lg:table-cell">Period</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy">Status</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden sm:table-cell">Priority</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden xl:table-cell">ARN / Ref</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden lg:table-cell">Department</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy">Due Date</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    <TableCell className="hidden sm:table-cell"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell className="hidden xl:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-8" /></TableCell>
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-ct-muted text-sm">
                    No compliance records found.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer hover:bg-ct-row-hover"
                    onClick={() => router.push(`/compliance/${item.id}`)}
                  >
                    <TableCell className="font-medium text-sm max-w-[220px] truncate text-ct-navy">
                      {item.title}
                    </TableCell>
                    <TableCell className="text-xs text-ct-muted hidden md:table-cell">
                      {item.complianceType.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-xs text-ct-muted hidden lg:table-cell">
                      {item.period ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] px-2 py-0.5 font-medium",
                          STATUS_BADGE[item.status] ?? ""
                        )}
                      >
                        {STATUS_LABELS[item.status] ?? item.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 capitalize",
                          PRIORITY_BADGE[item.priority] ?? ""
                        )}
                      >
                        {item.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-ct-navy font-mono hidden xl:table-cell">
                      {item.acknowledgementNumber ? (
                        <span title={item.acknowledgementNumber} className="truncate block max-w-[120px]">
                          {item.acknowledgementNumber}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-ct-muted hidden lg:table-cell">
                      {item.department.name}
                    </TableCell>
                    <TableCell className="text-xs text-ct-navy font-medium">
                      {item.dueDate ? format(new Date(item.dueDate), "dd MMM yyyy") : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-ct-muted hover:text-ct-saffron"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/compliance/${item.id}`);
                        }}
                      >
                        <Eye className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-ct-border">
            <p className="text-xs text-ct-muted">
              Page {page} of {totalPages} ({total} items)
            </p>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={page === pageNum ? "default" : "outline"}
                    size="icon"
                    className="size-8"
                    onClick={() => setPage(pageNum)}
                  >
                    {pageNum}
                  </Button>
                );
              })}
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* FAB */}
      <Link href="/compliance/new">
        <button className="fixed bottom-6 right-6 size-14 rounded-full bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron-fab flex items-center justify-center transition-transform hover:scale-105 z-20">
          <Plus className="size-6" />
        </button>
      </Link>
    </div>
  );
}

// useSearchParams() requires a Suspense boundary in this repo's own
// established convention (see reports/page.tsx's CustomReportsSection).
export default function CompliancePage() {
  return (
    <Suspense fallback={<div className="text-sm text-ct-muted">Loading compliance register...</div>}>
      <ComplianceRegisterView />
    </Suspense>
  );
}