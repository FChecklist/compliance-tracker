"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import {
  ShieldCheck,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  TrendingUp,
  ArrowUpRight,
  Activity,
  Clock,
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
  Legend,
} from "recharts";

type DashboardStats = {
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
  upcomingDeadlines: {
    id: string;
    title: string;
    department: string;
    dueDate: string | null;
    assignedTo: string;
    status: string;
  }[];
  recentActivity: {
    id: string;
    action: string;
    entityType: string;
    details: string | null;
    userName: string;
    createdAt: string;
  }[];
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  overdue: "bg-red-100 text-red-700",
  not_applicable: "bg-gray-100 text-gray-600",
  draft: "bg-purple-100 text-purple-700",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  overdue: "Overdue",
  not_applicable: "N/A",
  draft: "Draft",
};

function StatCard({
  title,
  value,
  icon: Icon,
  accent,
  iconBg,
  sub,
}: {
  title: string;
  value: number;
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
          <div className={`size-10 rounded-xl flex items-center justify-center ${iconBg}`}>
            <Icon className={`size-5 ${accent}`} />
          </div>
        </div>
        <p className="text-3xl font-bold text-ct-navy">{value}</p>
        {sub && <p className="text-xs text-ct-muted mt-1.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="rounded-xl">
            <CardContent className="p-5">
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-9 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="rounded-xl">
        <CardContent className="p-6">
          <Skeleton className="h-5 w-48 mb-4" />
          <Skeleton className="h-[240px]" />
        </CardContent>
      </Card>
    </div>
  );
}

export function DashboardAnalytics() {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [notSetup, setNotSetup] = useState(false);

  useEffect(() => {
    // Trigger overdue sync before fetching stats (was incorrectly in GET stats)
    fetch("/api/compliance/overdue", { method: "POST" }).catch(() => {});

    fetch("/api/compliance/stats")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.orgName) setOrgName(d.orgName);
        if (!d.orgId) setNotSetup(true);
      })
      .catch(() => {});
  }, []);

  if (loading) return <DashboardSkeleton />;
  if (notSetup) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <ShieldCheck className="size-14 text-ct-saffron mb-4" />
      <h2 className="font-heading text-2xl text-ct-navy mb-2">Account Setup Incomplete</h2>
      <p className="text-ct-muted max-w-md mb-6">
        Your account is not linked to an organisation yet. Please contact your administrator to complete your account setup.
      </p>
    </div>
  );
  if (!data)
    return <p className="text-ct-muted">Failed to load dashboard.</p>;

  const completionRate = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Organisation Analytics</h1>
        <p className="text-sm text-ct-muted mt-1">
          {`Compliance overview for ${orgName ?? 'your organisation'}`}
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Compliance"
          value={data.total}
          icon={ShieldCheck}
          accent="text-ct-navy"
          iconBg="bg-ct-cloud"
          sub={`${completionRate}% completion rate`}
        />
        <StatCard
          title="Overdue"
          value={data.overdue}
          icon={AlertTriangle}
          accent="text-red-600"
          iconBg="bg-red-50"
          sub="Requires attention"
        />
        <StatCard
          title="Due This Week"
          value={data.dueThisWeek}
          icon={Calendar}
          accent="text-amber-600"
          iconBg="bg-amber-50"
          sub="Coming up soon"
        />
        <StatCard
          title="Completed"
          value={data.completed}
          icon={CheckCircle2}
          accent="text-emerald-600"
          iconBg="bg-emerald-50"
          sub={`${data.total - data.completed} remaining`}
        />
      </div>

      {/* Pendency Bar Chart */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
            <TrendingUp className="size-4 text-ct-saffron" />
            Pendency by Department
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.byDepartment}
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
                <Bar dataKey="overdue" name="Overdue" fill="#C0392B" radius={[2, 2, 0, 0]} barSize={16} />
                <Bar dataKey="pending" name="Pending" fill="#F5820A" radius={[2, 2, 0, 0]} barSize={16} />
                <Bar dataKey="safe" name="Safe" fill="#0E7C6E" radius={[2, 2, 0, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Bottom Row: Upcoming Deadlines + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Upcoming Deadlines */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
                <Clock className="size-4 text-ct-saffron" />
                Upcoming Deadlines
              </CardTitle>
              <Link
                href="/compliance"
                className="text-xs text-ct-saffron hover:underline flex items-center gap-1 font-medium"
              >
                View all <ArrowUpRight className="size-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {data.upcomingDeadlines.length === 0 ? (
              <p className="text-sm text-ct-muted py-4">No upcoming deadlines.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Title</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Dept</TableHead>
                    <TableHead className="text-xs hidden md:table-cell">Assigned</TableHead>
                    <TableHead className="text-xs">Due</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.upcomingDeadlines.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer hover:bg-ct-row-hover"
                      onClick={() =>
                        (window.location.href = `/compliance/${item.id}`)
                      }
                    >
                      <TableCell className="text-xs font-medium max-w-[140px] truncate">
                        <Link
                          href={`/compliance/${item.id}`}
                          className="hover:text-ct-saffron transition-colors"
                        >
                          {item.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs text-ct-muted hidden sm:table-cell">
                        {item.department}
                      </TableCell>
                      <TableCell className="text-xs text-ct-muted hidden md:table-cell">
                        {item.assignedTo}
                      </TableCell>
                      <TableCell className="text-xs text-ct-navy font-medium">
                        {item.dueDate
                          ? format(new Date(item.dueDate), "dd MMM")
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] px-2 py-0.5 font-medium ${STATUS_BADGE[item.status] ?? ""}`}
                        >
                          {STATUS_LABELS[item.status] ?? item.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
              <Activity className="size-4 text-ct-teal" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {data.recentActivity.length === 0 ? (
              <p className="text-sm text-ct-muted py-4">No recent activity yet.</p>
            ) : (
              <div className="space-y-3 max-h-[280px] overflow-y-auto">
                {data.recentActivity.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 text-sm">
                    <div className="mt-1.5 size-2 rounded-full bg-ct-teal shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-ct-navy truncate">{log.details ?? log.action}</p>
                      <p className="text-xs text-ct-muted">
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
