"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Users,
  ShieldCheck,
  ChevronRight,
  Plus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

type Department = {
  id: string;
  name: string;
  description: string | null;
  complianceCount: number;
  memberCount: number;
  headName: string | null;
  completedCount: number;
  createdAt: string;
  updatedAt: string;
};

export default function DepartmentsPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/departments")
      .then((r) => r.json())
      .then((d) => {
        setDepartments(d.departments ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Departments</h1>
          <p className="text-sm text-ct-muted mt-1">
            {departments.length} departments managing compliance
          </p>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
          <Plus className="size-4 mr-2" />
          Add Department
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="rounded-xl">
              <CardContent className="p-5">
                <Skeleton className="h-5 w-32 mb-2" />
                <Skeleton className="h-4 w-48 mb-4" />
                <Skeleton className="h-4 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {departments.map((dept) => {
            const progressPct = dept.complianceCount > 0
              ? Math.round((dept.completedCount / dept.complianceCount) * 100)
              : 0;

            return (
              <Card
                key={dept.id}
                className="rounded-xl shadow-card bg-white cursor-pointer hover:shadow-nav transition-shadow"
                onClick={() => router.push(`/departments/${dept.id}`)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-xl bg-ct-accent flex items-center justify-center">
                        <Building2 className="size-5 text-ct-saffron" />
                      </div>
                      <div>
                        <CardTitle className="text-base font-heading text-ct-navy">
                          {dept.name}
                        </CardTitle>
                        {dept.headName && (
                          <p className="text-xs text-ct-muted mt-0.5">
                            Head: {dept.headName}
                          </p>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="size-4 text-ct-muted shrink-0 mt-1" />
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {dept.description && (
                    <p className="text-sm text-ct-muted mb-3 line-clamp-2">
                      {dept.description}
                    </p>
                  )}

                  {/* Stats row */}
                  <div className="flex items-center gap-4 mb-3">
                    <div className="flex items-center gap-1.5 text-xs text-ct-muted">
                      <ShieldCheck className="size-3.5" />
                      {dept.complianceCount} items
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-ct-muted">
                      <Users className="size-3.5" />
                      {dept.memberCount} members
                    </div>
                  </div>

                  {/* Progress bar */}
                  {dept.complianceCount > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-ct-muted">Completion</span>
                        <span className="font-semibold text-ct-navy">{progressPct}%</span>
                      </div>
                      <Progress value={progressPct} className="h-2" />
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