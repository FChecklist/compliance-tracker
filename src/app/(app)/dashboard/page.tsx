"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  ShieldCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Activity,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

type DashboardData = {
  stats: {
    total: number;
    completed: number;
    overdue: number;
    inProgress: number;
    pending: number;
    dueSoon: number;
    notApplicable: number;
  };
  departmentBreakdown: { name: string; count: number }[];
  overdueItems: {
    id: string;
    title: string;
    department: string;
    dueDate: string | null;
    priority: string;
  }[];
  recentActivity: {
    id: string;
    action: string;
    entityType: string;
    details: string | null;
    userName: string;
    createdAt: string;
  }[];
  statusDistribution: { name: string; value: number; color: string }[];
};

const PRIORITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-emerald-100 text-emerald-700",
};

const ACTION_ICONS: Record<string, string> = {
  created: "🆕",
  status_changed: "🔄",
  assigned: "👤",
  comment_added: "💬",
};

function StatCard({
  title,
  value,
  icon: Icon,
  accent,
  sub,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  accent: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-muted-foreground">
            {title}
          </span>
          <div className={`size-9 rounded-lg flex items-center justify-center ${accent}`}>
            <Icon className="size-4" />
          </div>
        </div>
        <p className="text-3xl font-bold">{value}</p>
        {sub && (
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-5">
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-9 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-5 w-40 mb-4" />
            <Skeleton className="h-[200px]" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-5 w-40 mb-4" />
            <Skeleton className="h-[200px]" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <DashboardSkeleton />;
  if (!data) return <p className="text-muted-foreground">Failed to load dashboard.</p>;

  const { stats, departmentBreakdown, overdueItems, recentActivity, statusDistribution } = data;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of your compliance status and recent activity
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Compliance"
          value={stats.total}
          icon={ShieldCheck}
          accent="bg-emerald-100 text-emerald-600"
          sub={`${stats.completed} of ${stats.total} completed`}
        />
        <StatCard
          title="Overdue"
          value={stats.overdue}
          icon={AlertTriangle}
          accent="bg-red-100 text-red-600"
          sub="Requires immediate attention"
        />
        <StatCard
          title="Due Soon"
          value={stats.dueSoon}
          icon={Clock}
          accent="bg-amber-100 text-amber-600"
          sub="Within next 7 days"
        />
        <StatCard
          title="Completed"
          value={stats.completed}
          icon={CheckCircle2}
          accent="bg-emerald-100 text-emerald-600"
          sub={`${stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}% completion rate`}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Department Bar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              Compliance by Department
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={departmentBreakdown}
                  layout="vertical"
                  margin={{ left: 10, right: 20, top: 5, bottom: 5 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={100}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      fontSize: "12px",
                    }}
                  />
                  <Bar
                    dataKey="count"
                    fill="#10b981"
                    radius={[0, 4, 4, 0]}
                    barSize={24}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Status Donut Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-6">
              <div className="h-[180px] w-[180px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusDistribution.filter((s) => s.value > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {statusDistribution.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: "8px",
                        border: "1px solid var(--border)",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2">
                {statusDistribution
                  .filter((s) => s.value > 0)
                  .map((s) => (
                    <div key={s.name} className="flex items-center gap-2 text-sm">
                      <div
                        className="size-3 rounded-full shrink-0"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="text-muted-foreground flex-1">
                        {s.name}
                      </span>
                      <span className="font-medium">{s.value}</span>
                    </div>
                  ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row: Overdue + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Overdue Items */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <AlertTriangle className="size-4 text-red-500" />
                Overdue Items
              </CardTitle>
              <Link
                href="/compliance?filter=overdue"
                className="text-xs text-emerald-600 hover:underline flex items-center gap-1"
              >
                View all <ArrowUpRight className="size-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {overdueItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No overdue items. Great job!
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Title</TableHead>
                    <TableHead className="text-xs">Dept</TableHead>
                    <TableHead className="text-xs">Priority</TableHead>
                    <TableHead className="text-xs">Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdueItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-xs font-medium max-w-[160px] truncate">
                        <Link
                          href={`/compliance/${item.id}`}
                          className="hover:text-emerald-600 hover:underline"
                        >
                          {item.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.department}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] px-1.5 py-0 ${PRIORITY_STYLES[item.priority] ?? ""}`}
                        >
                          {item.priority}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-red-600 font-medium">
                        {item.dueDate
                          ? formatDistanceToNow(new Date(item.dueDate), {
                              addSuffix: true,
                            })
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="size-4 text-emerald-500" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No recent activity yet.
              </p>
            ) : (
              <div className="space-y-3 max-h-[240px] overflow-y-auto">
                {recentActivity.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 text-sm"
                  >
                    <span className="text-base mt-0.5">
                      {ACTION_ICONS[log.action] ?? "📝"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground truncate">
                        {log.details ?? log.action}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {log.userName} &middot;{" "}
                        {formatDistanceToNow(new Date(log.createdAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}