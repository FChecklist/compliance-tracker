"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Calendar,
  Building2,
  Tag,
  Clock,
  CheckCircle2,
  PlayCircle,
  AlertTriangle,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  in_progress: "bg-cyan-100 text-cyan-800",
  completed: "bg-emerald-100 text-emerald-800",
  overdue: "bg-red-100 text-red-800",
  not_applicable: "bg-zinc-100 text-zinc-600",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  overdue: "Overdue",
  not_applicable: "Not Applicable",
};

const PRIORITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-emerald-100 text-emerald-700",
};

type ComplianceDetail = {
  id: string;
  title: string;
  description: string | null;
  complianceType: string;
  status: string;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  department: { name: string };
  auditLogs: {
    id: string;
    action: string;
    details: string | null;
    createdAt: string;
    userName: string;
  }[];
};

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-96 max-w-full" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-32" />
    </div>
  );
}

export default function ComplianceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [data, setData] = useState<ComplianceDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDetail = () => {
    setLoading(true);
    fetch(`/api/compliance/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => {
        setData({ ...d.item, auditLogs: d.auditLogs ?? [] });
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        toast.error("Failed to load compliance item");
      });
  };

  useEffect(() => {
    fetchDetail();
  }, [params.id]);

  const changeStatus = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/compliance/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Status changed to ${STATUS_LABELS[newStatus]}`);
      fetchDetail();
    } catch {
      toast.error("Failed to update status");
    }
  };

  if (loading) return <DetailSkeleton />;
  if (!data)
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Item not found.</p>
        <Button variant="link" onClick={() => router.push("/compliance")}>
          Back to list
        </Button>
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/compliance"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition"
      >
        <ArrowLeft className="size-4" />
        Back to Compliance
      </Link>

      {/* Title row */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">{data.title}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="secondary"
              className={`text-xs ${STATUS_STYLES[data.status] ?? ""}`}
            >
              {STATUS_LABELS[data.status]}
            </Badge>
            <Badge
              variant="secondary"
              className={`text-xs ${PRIORITY_STYLES[data.priority] ?? ""}`}
            >
              {data.priority}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {data.status !== "completed" && (
            <Button
              size="sm"
              variant="outline"
              className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
              onClick={() => changeStatus("completed")}
            >
              <CheckCircle2 className="size-4 mr-1.5" />
              Complete
            </Button>
          )}
          {data.status === "pending" && (
            <Button
              size="sm"
              variant="outline"
              className="border-cyan-200 text-cyan-700 hover:bg-cyan-50"
              onClick={() => changeStatus("in_progress")}
            >
              <PlayCircle className="size-4 mr-1.5" />
              Start
            </Button>
          )}
          {data.status !== "overdue" && data.status !== "completed" && (
            <Button
              size="sm"
              variant="outline"
              className="border-red-200 text-red-700 hover:bg-red-50"
              onClick={() => changeStatus("overdue")}
            >
              <AlertTriangle className="size-4 mr-1.5" />
              Mark Overdue
            </Button>
          )}
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Building2 className="size-3.5" />
              Department
            </div>
            <p className="text-sm font-medium">{data.department.name}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Tag className="size-3.5" />
              Type
            </div>
            <p className="text-sm font-medium">{data.complianceType}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Calendar className="size-3.5" />
              Due Date
            </div>
            <p className="text-sm font-medium">
              {data.dueDate ? format(new Date(data.dueDate), "dd MMM yyyy") : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Clock className="size-3.5" />
              Last Updated
            </div>
            <p className="text-sm font-medium">
              {formatDistanceToNow(new Date(data.updatedAt), { addSuffix: true })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Description */}
      {data.description && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {data.description}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Audit Trail */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <History className="size-4" />
            Audit Trail
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.auditLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {data.auditLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-3">
                  <div className="mt-1.5 size-2 rounded-full bg-emerald-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm">{log.details ?? log.action}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
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
  );
}