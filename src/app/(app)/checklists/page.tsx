"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
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

type ComplianceItem = {
  id: string;
  title: string;
  description: string | null;
  complianceType: string;
  status: string;
  priority: string;
  dueDate: string | null;
  department: { name: string };
  assignedTo: { name: string; avatarUrl: string | null } | null;
  createdAt: string;
  updatedAt: string;
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

const PRIORITY_LABELS: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const COMPLIANCE_TYPES = [
  "GST",
  "TDS",
  "MCA",
  "PF",
  "ESIC",
  "ROC",
  "LABOUR",
  "ENVIRONMENTAL",
];

function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || status === "completed") return false;
  return new Date(dueDate) < new Date();
}

export default function ChecklistsPage() {
  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const limit = 20;
  const totalPages = Math.ceil(total / limit);

  const updateFilter = (updater: () => void) => {
    setLoading(true);
    updater();
    setPage(1);
  };

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    params.set("page", page.toString());
    params.set("limit", limit.toString());
    if (search) params.set("search", search);
    if (statusFilter !== "all") params.set("status", statusFilter);
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
    return () => {
      cancelled = true;
    };
  }, [page, search, statusFilter, typeFilter]);

  const hasActiveFilters =
    statusFilter !== "all" || typeFilter !== "all" || search !== "";

  const clearFilters = () => {
    setStatusFilter("all");
    setTypeFilter("all");
    setSearch("");
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">
          Checklists
        </h1>
        <p className="text-sm text-ct-muted mt-1">
          Track all compliance obligations by category
        </p>
      </div>

      {/* Filters */}
      <Card className="rounded-xl shadow-card bg-white p-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 size-4 text-ct-muted" />
            <Input
              placeholder="Search checklists..."
              value={search}
              onChange={(e) => updateFilter(() => setSearch(e.target.value))}
              className="pl-8 h-9"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Select
              value={statusFilter}
              onValueChange={(v) => updateFilter(() => setStatusFilter(v))}
            >
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={typeFilter}
              onValueChange={(v) => updateFilter(() => setTypeFilter(v))}
            >
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {COMPLIANCE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2"
                onClick={clearFilters}
              >
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
                <TableHead className="text-xs font-semibold text-ct-navy">
                  Title
                </TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden md:table-cell">
                  Type
                </TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy">
                  Status
                </TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden sm:table-cell">
                  Priority
                </TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden lg:table-cell">
                  Department
                </TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden lg:table-cell">
                  Assigned To
                </TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy">
                  Due Date
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-48" />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-32 text-center text-ct-muted text-sm"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <ClipboardList className="size-8 text-ct-border" />
                      <span>No checklists found.</span>
                      {hasActiveFilters && (
                        <Button
                          variant="link"
                          size="sm"
                          className="text-ct-saffron"
                          onClick={clearFilters}
                        >
                          Clear filters
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer hover:bg-ct-row-hover"
                    onClick={() =>
                      (window.location.href = `/checklists/${item.id}`)
                    }
                  >
                    <TableCell className="font-medium text-sm max-w-[240px] truncate text-ct-navy">
                      <Link
                        href={`/checklists/${item.id}`}
                        className="hover:text-ct-saffron transition-colors"
                      >
                        {item.title}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-2 py-0.5 font-medium border-ct-border text-ct-slate"
                      >
                        {item.complianceType.replace("_", " ")}
                      </Badge>
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
                        {PRIORITY_LABELS[item.priority] ?? item.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-ct-muted hidden lg:table-cell">
                      {item.department.name}
                    </TableCell>
                    <TableCell className="text-xs text-ct-muted hidden lg:table-cell">
                      {item.assignedTo?.name ?? "Unassigned"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-xs font-medium",
                        isOverdue(item.dueDate, item.status)
                          ? "text-red-600"
                          : "text-ct-navy"
                      )}
                    >
                      {item.dueDate
                        ? format(new Date(item.dueDate), "dd MMM yyyy")
                        : "—"}
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
              {Array.from(
                { length: Math.min(5, totalPages) },
                (_, i) => {
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
                }
              )}
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
    </div>
  );
}