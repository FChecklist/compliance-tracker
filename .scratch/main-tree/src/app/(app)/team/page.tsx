"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Users, Mail, Building2 } from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type UserItem = {
  id: string;
  name: string;
  email: string;
  role: string;
  department: { name: string; id: string };
  isActive: boolean;
  lastLoginAt: string | null;
  avatarUrl: string | null;
};

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-ct-navy text-white",
  manager: "bg-ct-saffron text-white",
  member: "bg-ct-teal text-white",
  viewer: "bg-gray-200 text-gray-700",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  member: "Member",
  viewer: "Viewer",
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function TeamCardSkeleton() {
  return (
    <Card className="rounded-xl shadow-card bg-white">
      <CardContent className="p-5">
        <div className="flex flex-col items-center text-center space-y-3">
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="space-y-1.5 w-full">
            <Skeleton className="h-5 w-32 mx-auto" />
            <Skeleton className="h-3.5 w-40 mx-auto" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <div className="flex items-center justify-center gap-1.5">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TeamPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [departmentCount, setDepartmentCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/users").then((r) => r.json()),
      fetch("/api/departments").then((r) => r.json()),
    ])
      .then(([u, d]) => {
        if (!cancelled) {
          setUsers(u.users ?? []);
          setDepartmentCount((d.departments ?? d ?? []).length);
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
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Team</h1>
        <p className="text-sm text-ct-muted mt-1">
          {!loading && (
            <>
              {users.length} member{users.length !== 1 ? "s" : ""} across{" "}
              {departmentCount} department{departmentCount !== 1 ? "s" : ""}
            </>
          )}
        </p>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <TeamCardSkeleton key={i} />
          ))}
        </div>
      ) : users.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white p-12 text-center">
          <Users className="size-10 text-ct-border mx-auto mb-3" />
          <p className="text-ct-muted">No team members found.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {users.map((user) => (
            <Card
              key={user.id}
              className="rounded-xl shadow-card bg-white hover:shadow-lg transition-shadow"
            >
              <CardContent className="p-5">
                <div className="flex flex-col items-center text-center space-y-3">
                  {/* Avatar */}
                  <div className="relative">
                    <Avatar className="h-14 w-14">
                      <AvatarFallback className="bg-ct-navy text-white text-sm font-bold">
                        {getInitials(user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-white",
                        user.isActive ? "bg-emerald-500" : "bg-gray-300"
                      )}
                    />
                  </div>

                  {/* Name */}
                  <div>
                    <p className="font-heading font-medium text-ct-navy text-base">
                      {user.name}
                    </p>
                    <p className="text-sm text-ct-muted flex items-center justify-center gap-1 mt-0.5">
                      <Mail className="size-3" />
                      {user.email}
                    </p>
                  </div>

                  {/* Role Badge */}
                  <Badge
                    className={cn(
                      "text-[10px] px-2.5 py-0.5 font-medium border-0",
                      ROLE_BADGE[user.role] ?? "bg-gray-100 text-gray-600"
                    )}
                  >
                    {ROLE_LABELS[user.role] ?? user.role}
                  </Badge>

                  {/* Department */}
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-2 py-0 bg-ct-cloud text-ct-slate"
                  >
                    <Building2 className="size-3 mr-1" />
                    {user.department?.name ?? "No Department"}
                  </Badge>

                  {/* Last Active */}
                  <div className="flex items-center gap-1.5 text-xs text-ct-muted">
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        user.isActive ? "bg-emerald-500" : "bg-gray-300"
                      )}
                    />
                    {user.isActive
                      ? user.lastLoginAt
                        ? `Active ${formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true })}`
                        : "Active now"
                      : "Inactive"}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}