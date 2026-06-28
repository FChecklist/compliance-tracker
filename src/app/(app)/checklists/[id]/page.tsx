"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Calendar,
  Building2,
  Tag,
  User,
  FileText,
  MessageSquare,
  History,
  ClipboardCheck,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

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

type ChecklistDetail = {
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
  assignedTo: { name: string; avatarUrl: string | null } | null;
  auditPoints: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    dueDate: string | null;
    assignedTo: { name: string } | null;
  }[];
  documents: {
    id: string;
    name: string;
    fileType: string | null;
    fileSize: number | null;
    uploadedBy: { name: string };
    createdAt: string;
  }[];
  comments: {
    id: string;
    content: string;
    author: { name: string; avatarUrl: string | null };
    createdAt: string;
  }[];
  auditLogs: {
    id: string;
    action: string;
    details: string | null;
    userName: string;
    createdAt: string;
  }[];
};

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-24" />
      <Card className="rounded-xl">
        <CardContent className="p-6">
          <Skeleton className="h-7 w-80 mb-3" />
          <div className="flex gap-2 mb-4">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <div className="flex gap-6">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-36" />
          </div>
        </CardContent>
      </Card>
      <Card className="rounded-xl">
        <CardContent className="p-6">
          <Skeleton className="h-5 w-48 mb-4" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChecklistDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [data, setData] = useState<ChecklistDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const id = params.id as string;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/compliance/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => {
        if (!cancelled) {
          setData({
            ...d.item,
            auditPoints: d.auditPoints ?? [],
            documents: d.documents ?? [],
            comments: d.comments ?? [],
            auditLogs: d.auditLogs ?? [],
          });
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <DetailSkeleton />;

  if (!data) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          className="text-ct-muted"
          onClick={() => router.push("/checklists")}
        >
          <ArrowLeft className="size-4 mr-2" /> Back to Checklists
        </Button>
        <Card className="rounded-xl shadow-card bg-white p-12 text-center">
          <AlertTriangle className="size-10 text-ct-border mx-auto mb-3" />
          <p className="text-ct-muted">Checklist item not found.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Button
        variant="ghost"
        className="text-ct-muted hover:text-ct-navy"
        onClick={() => router.push("/checklists")}
      >
        <ArrowLeft className="size-4 mr-2" /> Back to Checklists
      </Button>

      {/* Header Card */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-6">
          <h1 className="font-heading text-xl md:text-2xl text-ct-navy leading-tight mb-3">
            {data.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] px-2 py-0.5 font-medium",
                STATUS_BADGE[data.status] ?? ""
              )}
            >
              {STATUS_LABELS[data.status] ?? data.status}
            </Badge>
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] px-2 py-0.5 capitalize font-medium",
                PRIORITY_BADGE[data.priority] ?? ""
              )}
            >
              {data.priority}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px] px-2 py-0.5 font-medium border-ct-border text-ct-slate"
            >
              <Tag className="size-3 mr-1" />
              {data.complianceType.replace("_", " ")}
            </Badge>
          </div>
          {data.description && (
            <p className="text-sm text-ct-slate leading-relaxed mb-4">
              {data.description}
            </p>
          )}
          <Separator className="mb-4" />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ct-muted">
            <span className="flex items-center gap-1.5">
              <Calendar className="size-3.5" />
              Due:{" "}
              <span className="font-medium text-ct-navy">
                {data.dueDate
                  ? format(new Date(data.dueDate), "dd MMM yyyy")
                  : "—"}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <Building2 className="size-3.5" />
              Department:{" "}
              <span className="font-medium text-ct-navy">
                {data.department.name}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <User className="size-3.5" />
              Assigned:{" "}
              <span className="font-medium text-ct-navy">
                {data.assignedTo?.name ?? "Unassigned"}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Audit Points / Checklist Items */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
            <ClipboardCheck className="size-4 text-ct-saffron" />
            Checklist Items ({data.auditPoints.length} items)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.auditPoints.length === 0 ? (
            <p className="text-sm text-ct-muted py-4 text-center">
              No checklist items defined for this compliance.
            </p>
          ) : (
            <div className="space-y-2">
              {data.auditPoints.map((ap) => (
                <div
                  key={ap.id}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border border-ct-border transition-colors",
                    ap.status === "completed"
                      ? "bg-emerald-50/50 border-emerald-200"
                      : "bg-white"
                  )}
                >
                  <Checkbox
                    checked={ap.status === "completed"}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        ap.status === "completed"
                          ? "text-ct-muted line-through"
                          : "text-ct-navy"
                      )}
                    >
                      {ap.title}
                    </p>
                    {ap.description && (
                      <p className="text-xs text-ct-muted mt-0.5">
                        {ap.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      {ap.dueDate && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-ct-cloud rounded text-ct-muted font-medium">
                          <Calendar className="size-2.5 inline mr-0.5" />
                          {format(new Date(ap.dueDate), "dd MMM yyyy")}
                        </span>
                      )}
                      {ap.assignedTo && (
                        <span className="text-[10px] text-ct-muted">
                          <User className="size-2.5 inline mr-0.5" />
                          {ap.assignedTo.name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Documents Section */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
            <FileText className="size-4 text-ct-teal" />
            Documents ({data.documents.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.documents.length === 0 ? (
            <p className="text-sm text-ct-muted py-4 text-center">
              No documents uploaded.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ct-border">
                    <th className="text-left text-xs font-semibold text-ct-navy py-2 pr-4">
                      Name
                    </th>
                    <th className="text-left text-xs font-semibold text-ct-navy py-2 pr-4 hidden sm:table-cell">
                      Type
                    </th>
                    <th className="text-left text-xs font-semibold text-ct-navy py-2 pr-4 hidden md:table-cell">
                      Size
                    </th>
                    <th className="text-left text-xs font-semibold text-ct-navy py-2 pr-4 hidden lg:table-cell">
                      Uploaded By
                    </th>
                    <th className="text-left text-xs font-semibold text-ct-navy py-2">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.documents.map((doc) => (
                    <tr
                      key={doc.id}
                      className="border-b border-ct-border last:border-0"
                    >
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <FileText className="size-4 text-ct-saffron shrink-0" />
                          <span className="font-medium text-ct-navy truncate max-w-[200px]">
                            {doc.name}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-ct-muted hidden sm:table-cell">
                        {doc.fileType ?? "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-ct-muted hidden md:table-cell">
                        {formatFileSize(doc.fileSize)}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-ct-muted hidden lg:table-cell">
                        {doc.uploadedBy.name}
                      </td>
                      <td className="py-2.5 text-xs text-ct-muted">
                        {format(new Date(doc.createdAt), "dd MMM yyyy")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom Row: Comments + Activity Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Comments */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
              <MessageSquare className="size-4 text-ct-saffron" />
              Comments ({data.comments.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.comments.length === 0 ? (
              <p className="text-sm text-ct-muted py-4 text-center">
                No comments yet.
              </p>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {data.comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-3">
                    <Avatar className="h-7 w-7 mt-0.5">
                      <AvatarFallback className="bg-ct-navy text-white text-[10px] font-bold">
                        {getInitials(c.author.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-semibold text-ct-navy">
                          {c.author.name}
                        </span>
                        <span className="text-[10px] text-ct-muted shrink-0 ml-2">
                          {formatDistanceToNow(new Date(c.createdAt), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-ct-slate leading-relaxed">
                        {c.content}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Log */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
              <History className="size-4 text-ct-teal" />
              Activity Log
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.auditLogs.length === 0 ? (
              <p className="text-sm text-ct-muted py-4 text-center">
                No activity recorded yet.
              </p>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {data.auditLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3">
                    <div className="mt-2 size-2 rounded-full bg-ct-teal shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ct-navy">
                        {log.details ?? log.action}
                      </p>
                      <p className="text-[10px] text-ct-muted mt-0.5">
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