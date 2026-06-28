"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  BarChart3,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
} from "recharts";

type ComplianceItem = {
  id: string;
  title: string;
  complianceType: string;
  status: string;
  priority: string;
  dueDate: string | null;
  department: { name: string };
  assignedTo: { name: string; avatarUrl: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

type Stats = {
  total: number;
  overdue: number;
  dueThisWeek: number;
  completed: number;
  byDepartment: {
    name: string;
    total: number;
    overdue: number;
    pending: number;
    safe: number;
  }[];
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

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B",
  in_progress: "#3B82F6",
  completed: "#10B981",
  overdue: "#EF4444",
  not_applicable: "#9CA3AF",
  draft: "#64748B",
};

const STATUS_PIE_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  overdue: "Overdue",
  not_applicable: "N/A",
  draft: "Draft",
};

function KpiCard({
  title,
  value,
  icon: Icon,
  accent,
  iconBg,
  sub,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  accent: string;
  iconBg: string;
  sub?: string;
}) {
  return (
    <Card className="rounded-xl shadow-card bg-white">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-ct-muted">{title}</span>
          <div
            className={cn("size-10 rounded-xl flex items-center justify-center", iconBg)}
          >
            <Icon className={cn("size-5", accent)} />
          </div>
        </div>
        <p className="text-3xl font-bold text-ct-navy">{value}</p>
        {sub && <p className="text-xs text-ct-muted mt-1.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function ReportsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="rounded-xl">
            <CardContent className="p-5">
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-9 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="rounded-xl">
          <CardContent className="p-6">
            <Skeleton className="h-5 w-36 mb-4" />
            <Skeleton className="h-[280px]" />
          </CardContent>
        </Card>
        <Card className="rounded-xl">
          <CardContent className="p-6">
            <Skeleton className="h-5 w-40 mb-4" />
            <Skeleton className="h-[280px]" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/compliance/stats").then((r) => r.json()),
      fetch("/api/compliance?limit=100").then((r) => r.json()),
    ])
      .then(([s, d]) => {
        if (!cancelled) {
          setStats(s);
          setItems(d.compliance ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pie chart data from status distribution
  const statusCounts: Record<string, number> = {};
  items.forEach((item) => {
    statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1;
  });
  const pieData = Object.entries(statusCounts)
    .map(([key, value]) => ({
      name: STATUS_PIE_LABELS[key] ?? key,
      value,
      color: STATUS_COLORS[key] ?? "#9CA3AF",
    }))
    .sort((a, b) => b.value - a.value);

  const totalItems = stats?.total ?? items.length;
  const overdueCount = stats?.overdue ?? 0;
  const completedCount = stats?.completed ?? 0;
  const completionRate =
    totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;
  const overduePct =
    totalItems > 0 ? Math.round((overdueCount / totalItems) * 100) : 0;

  // CSV Export
  const exportCSV = () => {
    const headers = [
      "Title",
      "Type",
      "Status",
      "Priority",
      "Department",
      "Assigned To",
      "Due Date",
      "Created",
    ];
    const rows = items.map((item) => [
      `"${item.title}"`,
      item.complianceType,
      STATUS_LABELS[item.status] ?? item.status,
      item.priority,
      item.department.name,
      item.assignedTo?.name ?? "Unassigned",
      item.dueDate ? format(new Date(item.dueDate), "yyyy-MM-dd") : "",
      format(new Date(item.createdAt), "yyyy-MM-dd"),
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join(
      "\n"
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-report-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <ReportsSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">
            Reports & Analytics
          </h1>
          <p className="text-sm text-ct-muted mt-1">
            Compliance performance overview
          </p>
        </div>
        <Button
          onClick={exportCSV}
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
        >
          <Download className="size-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          title="Total Items"
          value={totalItems}
          icon={ShieldCheck}
          accent="text-ct-navy"
          iconBg="bg-ct-cloud"
          sub="All compliance items"
        />
        <KpiCard
          title="Overdue"
          value={overdueCount}
          icon={AlertTriangle}
          accent="text-red-600"
          iconBg="bg-red-50"
          sub={`${overduePct}% of total items`}
        />
        <KpiCard
          title="Completion Rate"
          value={`${completionRate}%`}
          icon={CheckCircle2}
          accent="text-emerald-600"
          iconBg="bg-emerald-50"
          sub={`${completedCount} of ${totalItems} completed`}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Donut Chart */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-ct-saffron" />
              Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center">
                <p className="text-sm text-ct-muted">No data available.</p>
              </div>
            ) : (
              <div className="relative h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={110}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: "10px",
                        border: "1px solid #E2E8F0",
                        fontSize: "12px",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
                      }}
                      formatter={(value: number, name: string) => [
                        `${value} items`,
                        name,
                      ]}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center Label */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-ct-navy">
                      {totalItems}
                    </p>
                    <p className="text-[10px] text-ct-muted">Total</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bar Chart */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
              <BarChart3 className="size-4 text-ct-teal" />
              Pendency by Department
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(!stats?.byDepartment || stats.byDepartment.length === 0) ? (
              <div className="h-[280px] flex items-center justify-center">
                <p className="text-sm text-ct-muted">No data available.</p>
              </div>
            ) : (
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={stats.byDepartment}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 12, fill: "#718096" }}
                      axisLine={{ stroke: "#E2E8F0" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: "#718096" }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "10px",
                        border: "1px solid #E2E8F0",
                        fontSize: "12px",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
                      }}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                    />
                    <Bar
                      dataKey="overdue"
                      name="Overdue"
                      fill="#C0392B"
                      radius={[2, 2, 0, 0]}
                      barSize={16}
                    />
                    <Bar
                      dataKey="pending"
                      name="Pending"
                      fill="#F5820A"
                      radius={[2, 2, 0, 0]}
                      barSize={16}
                    />
                    <Bar
                      dataKey="safe"
                      name="Safe"
                      fill="#0E7C6E"
                      radius={[2, 2, 0, 0]}
                      barSize={16}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Full Compliance Table */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-ct-navy">
            All Compliance Items ({items.length})
          </CardTitle>
        </CardHeader>
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
              {items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-24 text-center text-ct-muted text-sm"
                  >
                    No compliance items found.
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
                    <TableCell className="text-xs text-ct-muted hidden md:table-cell">
                      {item.complianceType.replace("_", " ")}
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
                    <TableCell className="text-xs text-ct-muted hidden lg:table-cell">
                      {item.department.name}
                    </TableCell>
                    <TableCell className="text-xs text-ct-muted hidden lg:table-cell">
                      {item.assignedTo?.name ?? "Unassigned"}
                    </TableCell>
                    <TableCell className="text-xs text-ct-navy font-medium">
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
      </Card>
    </div>
  );
}