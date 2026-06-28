"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Search, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn } from "@/lib/utils";

type AuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string | null;
  userName: string;
  createdAt: string;
};

const ACTION_BADGE: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-red-100 text-red-700",
  status_change: "bg-amber-100 text-amber-700",
  assign: "bg-purple-100 text-purple-700",
  reassign: "bg-purple-100 text-purple-700",
  login: "bg-gray-100 text-gray-600",
  logout: "bg-gray-100 text-gray-600",
  export: "bg-cyan-100 text-cyan-700",
  invite: "bg-ct-accent text-ct-saffron",
};

const ACTION_LABELS: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  status_change: "Status Change",
  assign: "Assigned",
  reassign: "Reassigned",
  login: "Login",
  logout: "Logout",
  export: "Export",
  invite: "Invite",
};

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const limit = 20;
  const totalPages = Math.ceil(total / limit);

  const updateFilter = (updater: () => void) => {
    setLoading(true);
    updater();
    setPage(1);
  };

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("page", page.toString());
    params.set("limit", limit.toString());
    if (actionFilter !== "all") params.set("action", actionFilter);
    if (entityFilter !== "all") params.set("entityType", entityFilter);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);

    fetch(`/api/audit?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setLogs(d.auditLogs ?? []);
        setTotal(d.total ?? 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, actionFilter, entityFilter, startDate, endDate]);

  const hasFilters = actionFilter !== "all" || entityFilter !== "all" || startDate || endDate;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Audit Log</h1>
        <p className="text-sm text-ct-muted mt-1">
          {total} activity records
        </p>
      </div>

      {/* Filters */}
      <Card className="rounded-xl shadow-card bg-white p-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={actionFilter} onValueChange={(v) => updateFilter(() => setActionFilter(v))}>
            <SelectTrigger className="w-[150px] h-9">
              <SelectValue placeholder="Action Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {Object.entries(ACTION_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={entityFilter} onValueChange={(v) => updateFilter(() => setEntityFilter(v))}>
            <SelectTrigger className="w-[170px] h-9">
              <SelectValue placeholder="Entity Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Entities</SelectItem>
              <SelectItem value="ComplianceItem">Compliance Item</SelectItem>
              <SelectItem value="User">User</SelectItem>
              <SelectItem value="Department">Department</SelectItem>
            </SelectContent>
          </Select>

          <Input
            type="date"
            value={startDate}
            onChange={(e) => updateFilter(() => setStartDate(e.target.value))}
            className="h-9 w-[150px]"
            placeholder="From date"
          />
          <Input
            type="date"
            value={endDate}
            onChange={(e) => updateFilter(() => setEndDate(e.target.value))}
            className="h-9 w-[150px]"
            placeholder="To date"
          />

          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => {
              setActionFilter("all");
              setEntityFilter("all");
              setStartDate("");
              setEndDate("");
              setPage(1);
            }}>
              <X className="size-3.5 mr-1" /> Clear
            </Button>
          )}
        </div>
      </Card>

      {/* Table */}
      <Card className="rounded-xl shadow-card bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold text-ct-navy">Timestamp</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy">User</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy">Action</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden sm:table-cell">Entity</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden md:table-cell">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-48" /></TableCell>
                    </TableRow>
                  ))
                : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-ct-muted text-sm">
                      No audit logs found.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id} className="hover:bg-ct-row-hover">
                      <TableCell className="text-xs text-ct-muted whitespace-nowrap">
                        {format(new Date(log.createdAt), "dd MMM yyyy, HH:mm")}
                      </TableCell>
                      <TableCell className="text-sm font-medium text-ct-navy">
                        {log.userName}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={cn(
                            "text-[10px] px-2 py-0.5 font-medium",
                            ACTION_BADGE[log.action] ?? "bg-gray-100 text-gray-600"
                          )}
                        >
                          {ACTION_LABELS[log.action] ?? log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-ct-muted hidden sm:table-cell">
                        {log.entityType}
                      </TableCell>
                      <TableCell className="text-xs text-ct-slate max-w-[300px] truncate hidden md:table-cell">
                        {log.details ?? "—"}
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
              Page {page} of {totalPages} ({total} records)
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