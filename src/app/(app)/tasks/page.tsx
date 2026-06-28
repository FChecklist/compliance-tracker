"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { motion } from "framer-motion";
import {
  CircleDot,
  Loader2,
  CheckCircle2,
  Calendar,
  Building2,
  User,
  LayoutGrid,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type ComplianceItem = {
  id: string;
  title: string;
  complianceType: string;
  status: string;
  priority: string;
  dueDate: string | null;
  department: { name: string };
  assignedTo: { name: string; avatarUrl: string | null } | null;
};

const PRIORITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-emerald-100 text-emerald-700",
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function isPastDue(dueDate: string | null) {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

type Column = {
  key: string;
  label: string;
  status: string;
  icon: React.ElementType;
  accent: string;
  dotColor: string;
};

const COLUMNS: Column[] = [
  {
    key: "todo",
    label: "TO DO",
    status: "pending",
    icon: CircleDot,
    accent: "text-amber-600",
    dotColor: "bg-amber-500",
  },
  {
    key: "inprogress",
    label: "IN PROGRESS",
    status: "in_progress",
    icon: Loader2,
    accent: "text-blue-600",
    dotColor: "bg-blue-500",
  },
  {
    key: "done",
    label: "DONE",
    status: "completed",
    icon: CheckCircle2,
    accent: "text-emerald-600",
    dotColor: "bg-emerald-500",
  },
];

function TaskCardSkeleton() {
  return (
    <Card className="rounded-xl bg-white border border-ct-border">
      <CardContent className="p-4 space-y-3">
        <div className="flex justify-between">
          <Skeleton className="h-5 w-12 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex items-center justify-between">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-6 w-6 rounded-full" />
        </div>
      </CardContent>
    </Card>
  );
}

function ColumnSkeleton() {
  return (
    <div className="min-w-[300px] max-w-[340px] w-full shrink-0 space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Skeleton className="size-4 rounded-full" />
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-6 rounded-full" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <TaskCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

function KanbanColumn({
  column,
  items,
  loading,
}: {
  column: Column;
  items: ComplianceItem[];
  loading: boolean;
}) {
  const Icon = column.icon;

  return (
    <div className="min-w-[300px] max-w-[340px] w-full shrink-0">
      {/* Column Header */}
      <div className="flex items-center gap-2 px-1 mb-3">
        <div className={cn("size-3 rounded-full", column.dotColor)} />
        <h3 className="text-sm font-semibold text-ct-navy">{column.label}</h3>
        <Badge
          variant="secondary"
          className="text-[10px] px-1.5 py-0 h-5 min-w-5 justify-center bg-ct-cloud text-ct-muted font-semibold"
        >
          {loading ? "—" : items.length}
        </Badge>
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <TaskCardSkeleton key={i} />
          ))
        ) : items.length === 0 ? (
          <p className="text-xs text-ct-muted text-center py-8 bg-ct-cloud/50 rounded-xl border border-dashed border-ct-border">
            No items
          </p>
        ) : (
          items.map((item) => (
            <motion.div
              key={item.id}
              whileHover={{ y: -2, boxShadow: "0 8px 25px -5px rgba(0,0,0,0.1)" }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              <Link href={`/checklists/${item.id}`}>
                <Card className="rounded-xl bg-white border border-ct-border cursor-pointer hover:border-ct-saffron/30 transition-colors">
                  <CardContent className="p-4 space-y-3">
                    {/* Top Row: Type + Priority */}
                    <div className="flex items-center justify-between">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 font-semibold border-ct-border text-ct-slate"
                      >
                        {item.complianceType.replace("_", " ")}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] px-1.5 py-0 font-medium capitalize",
                          PRIORITY_BADGE[item.priority] ?? ""
                        )}
                      >
                        {PRIORITY_LABELS[item.priority] ?? item.priority}
                      </Badge>
                    </div>

                    {/* Title */}
                    <p className="text-sm font-medium text-ct-navy leading-snug line-clamp-2">
                      {item.title}
                    </p>

                    {/* Bottom Row: Due Date + Department + Assigned */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {item.dueDate && (
                          <span
                            className={cn(
                              "text-[11px] flex items-center gap-1 font-medium shrink-0",
                              isPastDue(item.dueDate) && column.key !== "done"
                                ? "text-red-600"
                                : "text-ct-muted"
                            )}
                          >
                            <Calendar className="size-3" />
                            {format(new Date(item.dueDate), "MMM d")}
                          </span>
                        )}
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 bg-ct-cloud text-ct-slate hidden sm:inline-flex"
                        >
                          <Building2 className="size-2.5 mr-0.5" />
                          {item.department.name}
                        </Badge>
                      </div>
                      {item.assignedTo && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Avatar className="h-5 w-5">
                            <AvatarFallback className="bg-ct-navy text-white text-[8px] font-bold">
                              {getInitials(item.assignedTo.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-[11px] text-ct-muted hidden sm:inline">
                            {item.assignedTo.name.split(" ")[0]}
                          </span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const [columns, setColumns] = useState<Record<string, ComplianceItem[]>>({
    todo: [],
    inprogress: [],
    done: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchColumn = (
      status: string,
      limit?: number
    ): Promise<ComplianceItem[]> => {
      const params = new URLSearchParams();
      params.set("status", status);
      params.set("limit", limit?.toString() ?? "100");
      return fetch(`/api/compliance?${params}`)
        .then((r) => r.json())
        .then((d) => d.compliance ?? []);
    };

    Promise.all([
      fetchColumn("pending"),
      fetchColumn("in_progress"),
      fetchColumn("completed", 10),
    ])
      .then(([todo, inprogress, done]) => {
        if (!cancelled) {
          setColumns({ todo, inprogress, done });
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">
          Tasks
        </h1>
        <p className="text-sm text-ct-muted mt-1 flex items-center gap-1.5">
          <LayoutGrid className="size-3.5" />
          Kanban view of compliance tasks
        </p>
      </div>

      {/* Kanban Board */}
      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((col) => (
            <ColumnSkeleton key={col.key} />
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.key}
              column={col}
              items={columns[col.key]}
              loading={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}