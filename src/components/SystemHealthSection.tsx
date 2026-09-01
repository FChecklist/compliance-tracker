"use client";

import { useState, useEffect, useCallback } from "react";
import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface RecentError {
  id: string;
  route: string | null;
  message: string;
  createdAt: string;
  digestId: string | null;
}

interface SystemHealth {
  sentryConfigured: boolean;
  count24h: number;
  count7d: number;
  recent: RecentError[];
}

// Cloud Deployment / Deployment Operations gap-closure, "Performance
// Monitoring" finding (dashboard-usage cadence not independently
// verified): the missing dashboard itself. Reads application_errors
// (instrumentation.ts's onRequestError fallback, which fires regardless of
// whether Sentry has a real DSN configured) so this stays a real signal
// even before SENTRY_DSN is provisioned. Admin-only, mirrors
// AdoptionMetricsSection's loading/layout conventions.
export default function SystemHealthSection() {
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<SystemHealth | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/system-health");
      if (!res.ok) return;
      setHealth(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!health) {
    return <p className="text-sm text-muted-foreground">System health data is unavailable right now.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Errors (24h)</span>
          </div>
          <div className="text-xl font-semibold text-ct-navy">{health.count24h}</div>
        </div>
        <div className="rounded-lg border p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Errors (7d)</span>
          </div>
          <div className="text-xl font-semibold text-ct-navy">{health.count7d}</div>
        </div>
        <div className="rounded-lg border p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {health.sentryConfigured ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-ct-teal" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            )}
            <span className="text-xs font-medium">Sentry</span>
          </div>
          <div className="text-sm font-semibold text-ct-navy">
            {health.sentryConfigured ? "Configured" : "Not configured"}
          </div>
          <p className="text-[11px] text-muted-foreground leading-tight">
            {health.sentryConfigured
              ? "SENTRY_DSN is set -- errors also report there."
              : "Errors below still recorded (DB fallback) even without a Sentry DSN."}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-ct-muted uppercase">Recent Errors</h4>
        {health.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No errors recorded.</p>
        ) : (
          <div className="rounded-lg border divide-y">
            {health.recent.map((err) => (
              <div key={err.id} className="p-3 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ct-navy truncate">{err.message}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {new Date(err.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {err.route && <Badge variant="outline" className="text-[10px]">{err.route}</Badge>}
                  {err.digestId && <span className="text-[11px] text-muted-foreground">digest: {err.digestId}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
