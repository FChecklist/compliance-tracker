"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  Plus,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Eye,
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

type Notice = {
  id: string;
  noticeNumber: string | null;
  authority: string | null;
  dateReceived: string;
  demandAmount: string | null;
  replyDeadline: string | null;
  status: string;
  description: string | null;
  department: { name: string };
  assignedTo: { name: string; avatarUrl: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_BADGE: Record<string, string> = {
  received: "bg-amber-100 text-amber-700",
  in_progress: "bg-blue-100 text-blue-700",
  replied: "bg-emerald-100 text-emerald-700",
  closed: "bg-gray-100 text-gray-600",
  appealed: "bg-purple-100 text-purple-700",
};

const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  in_progress: "In Progress",
  replied: "Replied",
  closed: "Closed",
  appealed: "Appealed",
};

function formatCurrency(amount: string | null): string {
  if (!amount) return "—";
  const num = parseFloat(amount);
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(num);
}

function isOverdue(deadline: string | null, status: string): boolean {
  if (!deadline) return false;
  if (status === "replied" || status === "closed") return false;
  return new Date(deadline) < new Date();
}

export default function NoticesPage() {
  const router = useRouter();
  const [items, setItems] = useState<Notice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");

  const limit = 20;
  const totalPages = Math.ceil(total / limit);

  const updateFilter = (updater: () => void) => {
    setLoading(true);
    updater();
    setPage(1);
  };

  useEffect(() => {
    fetch("/api/departments")
      .then((r) => r.json())
      .then((d) => setDepartments(d.departments ?? d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    params.set("page", page.toString());
    params.set("limit", limit.toString());
    if (search) params.set("search", search);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (deptFilter !== "all") params.set("departmentId", deptFilter);

    fetch(`/api/notices?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setItems(d.notices ?? []);
          setTotal(d.total ?? 0);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [page, search, statusFilter, deptFilter]);

  const hasActiveFilters = statusFilter !== "all" || deptFilter !== "all";

  const clearFilters = () => {
    setStatusFilter("all");
    setDeptFilter("all");
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Notice Register</h1>
          <p className="text-sm text-ct-muted mt-1">
            {total} notice{total !== 1 ? "s" : ""} tracked
          </p>
        </div>
        <Button
          asChild
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
        >
          <Link href="/notices/new">
            <Plus className="size-4 mr-2" />
            Add Notice
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <Card className="rounded-xl shadow-card bg-white p-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 size-4 text-ct-muted" />
            <Input
              placeholder="Search notice number, authority..."
              value={search}
              onChange={(e) => updateFilter(() => setSearch(e.target.value))}
              className="pl-8 h-9"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={(v) => updateFilter(() => setStatusFilter(v))}>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="replied">Replied</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="appealed">Appealed</SelectItem>
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
                <TableHead className="text-xs font-semibold text-ct-navy">Notice Number</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden md:table-cell">Authority</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy">Status</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden sm:table-cell">Demand Amount</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden lg:table-cell">Reply Deadline</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden lg:table-cell">Assigned To</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                    <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-8" /></TableCell>
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-ct-muted text-sm">
                    No notices found.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer hover:bg-ct-row-hover"
                    onClick={() => router.push(`/notices/${item.id}`)}
                  >
                    <TableCell className="font-medium text-sm max-w-[180px] truncate text-ct-navy">
                      {item.noticeNumber ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-ct-muted hidden md:table-cell">
                      {item.authority ?? "—"}
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
                    <TableCell className="text-xs text-ct-navy font-medium hidden sm:table-cell">
                      {formatCurrency(item.demandAmount)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className={cn(
                        "text-xs font-medium",
                        isOverdue(item.replyDeadline, item.status)
                          ? "text-red-600"
                          : "text-ct-navy"
                      )}>
                        {item.replyDeadline
                          ? format(new Date(item.replyDeadline), "dd MMM yyyy")
                          : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-ct-muted hidden lg:table-cell">
                      {item.assignedTo?.name ?? "Unassigned"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-ct-muted hover:text-ct-saffron"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/notices/${item.id}`);
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
      <Link href="/notices/new">
        <button className="fixed bottom-6 right-6 size-14 rounded-full bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron-fab flex items-center justify-center transition-transform hover:scale-105 z-20">
          <Plus className="size-6" />
        </button>
      </Link>
    </div>
  );
}