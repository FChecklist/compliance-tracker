"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  AlertTriangle,
  FileText,
  Building2,
  User,
  Calendar,
  Hash,
  Shield,
  Clock,
  FolderOpen,
  Paperclip,
  Loader2,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type NoticeDetail = {
  id: string;
  noticeNumber: string | null;
  authority: string | null;
  dateReceived: string;
  demandAmount: number | string | null;
  replyDeadline: string | null;
  status: string;
  description: string | null;
  departmentId: string;
  department: { name: string };
  assignedTo: { name: string; avatarUrl: string | null } | null;
  complianceItem: {
    id: string;
    title: string;
    complianceType: string;
    status: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};

type NoticeResponse = {
  item: NoticeDetail;
  documents: unknown[];
  comments: unknown[];
  auditLogs: unknown[];
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

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

const NOTICE_STATUSES = [
  { value: "received", label: "Received" },
  { value: "in_progress", label: "In Progress" },
  { value: "replied", label: "Replied" },
  { value: "closed", label: "Closed" },
  { value: "appealed", label: "Appealed" },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatCurrency(amount: number | string | null): string {
  if (amount === null || amount === undefined) return "—";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
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

/* ------------------------------------------------------------------ */
/*  Detail Grid Label                                                  */
/* ------------------------------------------------------------------ */

function DetailRow({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <Icon className="size-4 text-ct-muted mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-ct-muted uppercase tracking-wide">
          {label}
        </p>
        <p className="text-sm text-ct-navy mt-0.5 break-words">{children}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading Skeleton                                                   */
/* ------------------------------------------------------------------ */

function NoticeDetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Back link */}
      <Skeleton className="h-4 w-28" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>

      {/* Details grid */}
      <Card className="rounded-xl shadow-card bg-white p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="size-4 rounded mt-0.5 shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Description */}
      <Card className="rounded-xl shadow-card bg-white p-6">
        <Skeleton className="h-5 w-36 mb-3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4 mt-2" />
      </Card>

      {/* Status update */}
      <Card className="rounded-xl shadow-card bg-white p-6">
        <Skeleton className="h-5 w-36 mb-3" />
        <Skeleton className="h-10 w-56" />
      </Card>

      {/* Documents */}
      <Card className="rounded-xl shadow-card bg-white p-6">
        <Skeleton className="h-5 w-36 mb-3" />
        <Skeleton className="h-16 w-full" />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page Component                                                */
/* ------------------------------------------------------------------ */

export default function NoticeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [notice, setNotice] = useState<NoticeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  /* ---- Fetch ---- */
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetch(`/api/notices/${id}`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) throw new Error("Notice not found");
          throw new Error("Failed to fetch notice");
        }
        return res.json() as Promise<NoticeResponse>;
      })
      .then((data) => {
        if (!cancelled) {
          setNotice(data.item);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  /* ---- Status Update ---- */
  const handleStatusChange = async (newStatus: string) => {
    if (!notice || newStatus === notice.status) return;

    setUpdating(true);
    try {
      const res = await fetch(`/api/notices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error);
      }

      const updated = await res.json();
      setNotice((prev) => (prev ? { ...prev, status: updated.status } : prev));
      toast.success(
        `Status updated to "${STATUS_LABELS[newStatus] ?? newStatus}"`
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update status"
      );
    } finally {
      setUpdating(false);
    }
  };

  /* ---- Error state ---- */
  if (error) {
    return (
      <div className="space-y-4">
        <Link
          href="/notices"
          className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition"
        >
          <ArrowLeft className="size-4" />
          Back to Notices
        </Link>
        <Card className="rounded-xl shadow-card bg-white p-8 text-center">
          <AlertTriangle className="size-10 text-red-400 mx-auto mb-3" />
          <h2 className="font-heading text-xl text-ct-navy mb-1">
            Something went wrong
          </h2>
          <p className="text-sm text-ct-muted">{error}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Try Again
          </Button>
        </Card>
      </div>
    );
  }

  /* ---- Loading state ---- */
  if (loading || !notice) {
    return (
      <div className="space-y-6">
        <NoticeDetailSkeleton />
      </div>
    );
  }

  const overdue = isOverdue(notice.replyDeadline, notice.status);

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <Link
        href="/notices"
        className="inline-flex items-center gap-1.5 text-sm text-ct-muted hover:text-ct-navy transition"
      >
        <ArrowLeft className="size-4" />
        Back to Notices
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy truncate">
            {notice.noticeNumber ?? "Untitled Notice"}
          </h1>
          {notice.authority && (
            <p className="text-sm text-ct-muted mt-0.5">{notice.authority}</p>
          )}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto shrink-0">
          {notice.authority && (
            <Badge
              variant="secondary"
              className="bg-ct-accent text-ct-teal text-[11px] px-2.5 py-0.5 font-medium"
            >
              <Shield className="size-3 mr-1" />
              {notice.authority}
            </Badge>
          )}
          <Badge
            variant="secondary"
            className={cn(
              "text-[11px] px-2.5 py-0.5 font-medium",
              STATUS_BADGE[notice.status] ?? ""
            )}
          >
            {STATUS_LABELS[notice.status] ?? notice.status}
          </Badge>
        </div>
      </div>

      {/* Key Details Grid */}
      <Card className="rounded-xl shadow-card bg-white p-6">
        <CardHeader className="p-0 pb-4 mb-4 border-b border-ct-border">
          <CardTitle className="text-base text-ct-navy flex items-center gap-2">
            <FileText className="size-4 text-ct-saffron" />
            Notice Details
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <DetailRow icon={Hash} label="Notice Number">
              {notice.noticeNumber ?? "—"}
            </DetailRow>

            <DetailRow icon={Shield} label="Authority">
              {notice.authority ?? "—"}
            </DetailRow>

            <DetailRow icon={Calendar} label="Date Received">
              {format(new Date(notice.dateReceived), "dd MMM yyyy")}
            </DetailRow>

            <DetailRow icon={Clock} label="Demand Amount">
              <span className="font-semibold">
                {formatCurrency(notice.demandAmount)}
              </span>
            </DetailRow>

            <DetailRow icon={AlertTriangle} label="Reply Deadline">
              <span
                className={cn(
                  "font-medium",
                  overdue ? "text-red-600" : "text-ct-navy"
                )}
              >
                {notice.replyDeadline
                  ? format(new Date(notice.replyDeadline), "dd MMM yyyy")
                  : "—"}
                {overdue && (
                  <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide bg-red-50 text-red-600 px-1.5 py-0.5 rounded">
                    Overdue
                  </span>
                )}
              </span>
            </DetailRow>

            <DetailRow icon={Building2} label="Department">
              {notice.department?.name ?? "—"}
            </DetailRow>

            <DetailRow icon={User} label="Assigned To">
              {notice.assignedTo?.name ?? (
                <span className="text-ct-muted italic">Unassigned</span>
              )}
            </DetailRow>

            <DetailRow icon={Clock} label="Status">
              <Badge
                variant="secondary"
                className={cn(
                  "text-[11px] px-2 py-0.5 font-medium",
                  STATUS_BADGE[notice.status] ?? ""
                )}
              >
                {STATUS_LABELS[notice.status] ?? notice.status}
              </Badge>
            </DetailRow>
          </div>
        </CardContent>
      </Card>

      {/* Description */}
      <Card className="rounded-xl shadow-card bg-white p-6">
        <CardHeader className="p-0 pb-3 mb-3">
          <CardTitle className="text-base text-ct-navy flex items-center gap-2">
            <FileText className="size-4 text-ct-saffron" />
            Description
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {notice.description ? (
            <p className="text-sm text-ct-navy leading-relaxed whitespace-pre-wrap">
              {notice.description}
            </p>
          ) : (
            <p className="text-sm text-ct-muted italic">
              No description provided.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Status Update */}
      <Card className="rounded-xl shadow-card bg-white p-6">
        <CardHeader className="p-0 pb-3 mb-3">
          <CardTitle className="text-base text-ct-navy flex items-center gap-2">
            <Clock className="size-4 text-ct-saffron" />
            Update Status
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <Select
              value={notice.status}
              onValueChange={handleStatusChange}
              disabled={updating}
            >
              <SelectTrigger className="w-full sm:w-56">
                {updating ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Updating...
                  </span>
                ) : (
                  <SelectValue />
                )}
              </SelectTrigger>
              <SelectContent>
                {NOTICE_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-ct-muted">
              Change the current status of this notice
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Documents (placeholder) */}
      <Card className="rounded-xl shadow-card bg-white p-6">
        <CardHeader className="p-0 pb-3 mb-3">
          <CardTitle className="text-base text-ct-navy flex items-center gap-2">
            <FolderOpen className="size-4 text-ct-saffron" />
            Documents
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex flex-col items-center justify-center py-8 text-center border-2 border-dashed border-ct-border rounded-lg">
            <Paperclip className="size-8 text-ct-muted mb-2" />
            <p className="text-sm text-ct-muted">No documents attached yet</p>
            <p className="text-xs text-ct-muted mt-1">
              Document upload will be available soon
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}