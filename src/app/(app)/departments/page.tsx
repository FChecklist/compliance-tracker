"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Users,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type Department = {
  id: string;
  name: string;
  description: string | null;
  complianceCount: number;
  createdAt: string;
  updatedAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500",
  in_progress: "bg-cyan-500",
  completed: "bg-emerald-500",
  overdue: "bg-red-500",
  not_applicable: "bg-zinc-400",
};

export default function DepartmentsPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [statusData, setStatusData] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/departments")
      .then((r) => r.json())
      .then((d) => {
        const depts = d.departments ?? d;
        setDepartments(depts);
        return Promise.all(
          depts.map((dept: Department) =>
            fetch(`/api/departments/${dept.id}`)
              .then((r) => r.json())
              .then((detail) => ({
                id: dept.id,
                statusCounts: detail.department?.statusCounts ?? {},
              }))
          )
        );
      })
      .then((results) => {
        const map: Record<string, Record<string, number>> = {};
        for (const r of results) {
          map[r.id] = r.statusCounts;
        }
        setStatusData(map);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Departments</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {departments.length} departments managing compliance
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="cursor-pointer">
              <CardContent className="p-5">
                <Skeleton className="h-5 w-32 mb-2" />
                <Skeleton className="h-4 w-48 mb-4" />
                <Skeleton className="h-4 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {departments.map((dept) => {
            const counts = statusData[dept.id] ?? {};
            const totalActive = Object.entries(counts)
              .filter(([k]) => k !== "not_applicable")
              .reduce((sum, [, v]) => sum + v, 0);

            return (
              <Card
                key={dept.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => router.push(`/departments/${dept.id}`)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <div className="size-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <Building2 className="size-4 text-emerald-600" />
                      </div>
                      {dept.name}
                    </CardTitle>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {dept.description && (
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                      {dept.description}
                    </p>
                  )}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <ShieldCheck className="size-3.5" />
                      {dept.complianceCount} compliance items
                    </div>
                    <Badge variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700">
                      {totalActive > 0
                        ? `${counts.completed ?? 0}/${totalActive} done`
                        : "No active items"}
                    </Badge>
                  </div>
                  {/* Mini progress bar */}
                  {totalActive > 0 && (
                    <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
                      {Object.entries(counts)
                        .filter(([k]) => k !== "not_applicable" && (counts[k] ?? 0) > 0)
                        .map(([status, count]) => (
                          <div
                            key={status}
                            className={`${STATUS_COLORS[status] ?? "bg-zinc-400"}`}
                            style={{ width: `${(count / totalActive) * 100}%` }}
                          />
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}