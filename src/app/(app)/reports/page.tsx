"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Presentation,
  FileType2,
  FileCode2,
  Sparkles,
} from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { exportPPTX, exportDocx, exportHTML } from "@/lib/report-export";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { ComplianceChart, type DeptData } from "@/components/ui/compliance-chart";
import { DataTable } from "@/components/ui/data-table";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import CustomReportsSection from "@/components/CustomReportsSection";
import ReportCatalogList from "@/components/ReportCatalogList";

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

const columns: ColumnDef<ComplianceItem>[] = [
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => {
      const item = row.original;
      return (
        <Link
          href={`/compliance/${item.id}`}
          className="font-medium text-sm text-ct-navy hover:text-ct-saffron transition-colors truncate block max-w-[240px]"
        >
          {item.title}
        </Link>
      );
    },
  },
  {
    accessorKey: "complianceType",
    header: "Type",
    cell: ({ getValue }) => (
      <span className="text-xs text-ct-muted">
        {String(getValue()).replace(/_/g, " ")}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ getValue }) => <StatusBadge status={String(getValue())} />,
  },
  {
    accessorKey: "priority",
    header: "Priority",
    cell: ({ getValue }) => <PriorityBadge priority={String(getValue())} />,
  },
  {
    accessorKey: "department",
    header: "Department",
    cell: ({ getValue }) => {
      const dept = getValue() as { name: string };
      return <span className="text-xs text-ct-muted">{dept.name}</span>;
    },
  },
  {
    accessorKey: "assignedTo",
    header: "Assigned To",
    cell: ({ getValue }) => {
      const user = getValue() as { name: string } | null;
      return (
        <span className="text-xs text-ct-muted">
          {user?.name ?? "Unassigned"}
        </span>
      );
    },
  },
  {
    accessorKey: "dueDate",
    header: "Due Date",
    cell: ({ getValue }) => {
      const d = getValue() as string | null;
      return (
        <span className="text-xs font-medium text-ct-navy">
          {d ? format(new Date(d), "dd MMM yyyy") : "—"}
        </span>
      );
    },
  },
];

export default function ReportsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/compliance/stats").then((r) => r.json()),
      fetch("/api/compliance?limit=1000").then((r) => r.json()),
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

  // Department data for ComplianceChart
  const deptChartData: DeptData[] = useMemo(() => {
    if (!stats?.byDepartment) return [];
    return stats.byDepartment.map((d) => ({
      name: d.name,
      overdue: d.overdue,
      pending: d.pending,
      safe: d.safe,
    }));
  }, [stats]);

  // Shared row builder so all three exports use identical columns/data.
  const buildExportRows = () =>
    items.map((item) => ({
      Title: item.title,
      Type: item.complianceType,
      Status: item.status,
      Priority: item.priority,
      Department: item.department.name,
      "Assigned To": item.assignedTo?.name ?? "Unassigned",
      "Due Date": item.dueDate ? format(new Date(item.dueDate), "yyyy-MM-dd") : "",
      Created: format(new Date(item.createdAt), "yyyy-MM-dd"),
    }));

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
      item.status,
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

  // Excel Export (xlsx)
  const exportExcel = () => {
    const data = buildExportRows();
    const ws = XLSX.utils.json_to_sheet(data);
    // Reasonable column widths for readability.
    ws["!cols"] = [
      { wch: 36 },
      { wch: 18 },
      { wch: 14 },
      { wch: 12 },
      { wch: 20 },
      { wch: 20 },
      { wch: 14 },
      { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Compliance Report");
    XLSX.writeFile(wb, `compliance-report-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  // PDF Export (jspdf + jspdf-autotable)
  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const generatedAt = format(new Date(), "yyyy-MM-dd HH:mm");

    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text("VERIDIAN Compliance Report", 40, 40);

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${generatedAt}`, 40, 58);
    doc.text(`Total Items: ${items.length}`, 40, 72);

    const data = buildExportRows();
    const head = [Object.keys(data[0] ?? { Title: "" })];
    const body = data.map((row) => Object.values(row));

    autoTable(doc, {
      head,
      body,
      startY: 90,
      styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 40, right: 40 },
    });

    doc.save(`compliance-report-${format(new Date(), "yyyy-MM-dd")}.pdf`);
  };

  // PPTX/Word/HTML exports (src/lib/report-export.ts) -- all three consume
  // the exact same buildExportRows() output as CSV/Excel/PDF above, so
  // every export format stays column-consistent by construction (no forked
  // data-shaping path).
  const exportMeta = { title: "VERIDIAN Compliance Report", fileNamePrefix: "compliance-report" };
  const handleExportPPTX = () => {
    void exportPPTX(buildExportRows(), exportMeta);
  };
  const handleExportDocx = () => {
    void exportDocx(buildExportRows(), exportMeta);
  };
  const handleExportHTML = () => {
    exportHTML(buildExportRows(), exportMeta);
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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={exportCSV}
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          >
            <Download className="size-4 mr-2" />
            Export CSV
          </Button>
          <Button
            onClick={exportExcel}
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          >
            <FileSpreadsheet className="size-4 mr-2" />
            Export Excel
          </Button>
          <Button
            onClick={exportPDF}
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          >
            <FileText className="size-4 mr-2" />
            Export PDF
          </Button>
          {/* Wave (2026-07-13): PPT/Word/HTML export -- same buildExportRows()
              data, same button style as the 3 exports above (per PR #104's
              precedent), added via src/lib/report-export.ts. */}
          <Button
            onClick={handleExportPPTX}
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          >
            <Presentation className="size-4 mr-2" />
            Export PPT
          </Button>
          <Button
            onClick={handleExportDocx}
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          >
            <FileType2 className="size-4 mr-2" />
            Export Word
          </Button>
          <Button
            onClick={handleExportHTML}
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          >
            <FileCode2 className="size-4 mr-2" />
            Export HTML
          </Button>
          {/* "Need a Report / Need an Analysis" upload-to-AI flow (Owner
              request, 2026-07-13) -- links to the new
              src/app/(app)/reports/create page; no existing lines here
              touched, purely additive. */}
          <Link href="/reports/create">
            <Button
              variant="outline"
              className="border-ct-saffron text-ct-saffron hover:bg-ct-saffron/10"
            >
              <Sparkles className="size-4 mr-2" />
              Need a Report? Upload &amp; let AI build it
            </Button>
          </Link>
        </div>
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
                      formatter={(value, name) => [
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

        {/* Department Bar Chart — using ComplianceChart */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-ct-teal" />
              Pendency by Department
            </CardTitle>
          </CardHeader>
          <CardContent>
            {deptChartData.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center">
                <p className="text-sm text-ct-muted">No data available.</p>
              </div>
            ) : (
              <ComplianceChart data={deptChartData} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Full Compliance Table — using DataTable */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-ct-navy">
            All Compliance Items ({items.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={items}
            searchKey="title"
            searchPlaceholder="Search compliance items..."
          />
        </CardContent>
      </Card>

      {/* Wave 173 (chain-integration for reports): CustomReportsSection reads
          ?report=<id> via useSearchParams to deep-link/highlight a specific
          saved report -- wrapped in Suspense per this codebase's own
          established convention for any useSearchParams consumer (see
          chat/page.tsx, forge/page.tsx). */}
      <Suspense fallback={<div className="text-sm text-ct-muted">Loading reports...</div>}>
        <CustomReportsSection />
      </Suspense>

      {/* Unified Reports & Analysis catalog -- report-catalog-service.ts.
          New, additive section: lists every report type across the 4
          report-producing services (custom, ERP financial, construction/
          PROJEXA, AI-ops cadence reports) with a link to where each one
          actually runs today. Does not touch/replace the compliance-items
          export above or CustomReportsSection -- purely additive. */}
      <ReportCatalogList />
    </div>
  );
}
