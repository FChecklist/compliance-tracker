"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowLeft, Building2, Users } from "lucide-react";
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

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  overdue: "bg-red-100 text-red-700",
  not_applicable: "bg-gray-100 text-gray-600",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  overdue: "Overdue",
  not_applicable: "N/A",
};

type DeptDetail = {
  id: string;
  name: string;
  description: string | null;
  complianceCount: number;
  statusCounts: Record<string, number>;
  users: { id: string; name: string; role: string }[];
  complianceItems: {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    complianceType: string;
  }[];
};

export default function DepartmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [data, setData] = useState<DeptDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/departments/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => {
        setData(d.department);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-16">
        <p className="text-ct-muted">Department not found.</p>
        <Link href="/departments" className="text-sm text-ct-teal hover:underline">
          Back to departments
        </Link>
      </div>
    );
  }

  const statusEntries = Object.entries(data.statusCounts).filter(([, v]) => v > 0);

  return (
    <div className="space-y-6">
      <Link
        href="/departments"
        className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition"
      >
        <ArrowLeft className="size-4" />
        Back to Departments
      </Link>

      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2">
          <Building2 className="size-6 text-ct-saffron" />
          {data.name}
        </h1>
        {data.description && (
          <p className="text-sm text-ct-muted mt-1">{data.description}</p>
        )}
      </div>

      {/* Status summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {statusEntries.map(([status, count]) => (
          <Card key={status} className="rounded-xl shadow-card bg-white">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-ct-navy">{count}</p>
              <Badge
                variant="secondary"
                className={`text-[10px] mt-1 ${STATUS_STYLES[status] ?? ""}`}
              >
                {STATUS_LABELS[status] ?? status}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Team */}
      {data.users.length > 0 && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-ct-navy flex items-center gap-2">
              <Users className="size-4 text-ct-teal" />
              Team Members ({data.users.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {data.users.map((u) => (
                <Badge key={u.id} variant="outline" className="text-xs">
                  {u.name}
                  <span className="ml-1 text-ct-muted">({u.role})</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compliance Items */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-ct-navy">
            Compliance Items ({data.complianceItems.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold text-ct-navy">Title</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden sm:table-cell">Type</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy">Status</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden md:table-cell">Due Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.complianceItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-ct-muted py-6">
                    No compliance items in this department.
                  </TableCell>
                </TableRow>
              ) : (
                data.complianceItems.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer hover:bg-ct-row-hover"
                    onClick={() => router.push(`/compliance/${item.id}`)}
                  >
                    <TableCell className="text-sm font-medium text-ct-navy">{item.title}</TableCell>
                    <TableCell className="text-xs text-ct-muted hidden sm:table-cell">
                      {item.complianceType.replace("_", " ")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${STATUS_STYLES[item.status] ?? ""}`}
                      >
                        {STATUS_LABELS[item.status] ?? item.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-ct-muted hidden md:table-cell">
                      {item.dueDate ? format(new Date(item.dueDate), "dd MMM yyyy") : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}