"use client";

import { useState, useEffect, useCallback } from "react";
import { Rocket, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface DeploymentEvent {
  id: string;
  vercelDeploymentId: string;
  eventType: string;
  projectName: string | null;
  target: string | null;
  deploymentUrl: string | null;
  state: string | null;
  receivedAt: string;
}

interface DeploymentHistory {
  receiverConfigured: boolean;
  events: DeploymentEvent[];
}

const EVENT_BADGE: Record<string, string> = {
  "deployment.succeeded": "bg-ct-teal/10 text-ct-teal",
  "deployment.error": "bg-red-100 text-red-700",
  "deployment.created": "bg-ct-accent text-ct-saffron",
};

// Cloud Deployment / Deployment Operations gap-closure, "Deployment Audit
// Trail" finding (webhook exists but downstream usage/dashboard not
// independently verified): the missing simple deployment-history view.
// Reads deployment_events, written by POST
// /api/webhooks/vercel-deployment. Admin-only, mirrors
// AdoptionMetricsSection's loading/layout conventions.
export default function DeploymentHistorySection() {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<DeploymentHistory | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/deployment-history");
      if (!res.ok) return;
      setHistory(await res.json());
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
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!history) {
    return <p className="text-sm text-muted-foreground">Deployment history is unavailable right now.</p>;
  }

  return (
    <div className="space-y-4">
      {!history.receiverConfigured && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            The Vercel deployment webhook receiver is not configured
            (<code className="text-[11px]">VERCEL_DEPLOYMENT_WEBHOOK_SECRET</code> unset) --
            it rejects every delivery until this is provisioned, so no rows will appear below yet.
          </p>
        </div>
      )}

      {history.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No deployment events recorded yet.</p>
      ) : (
        <div className="rounded-lg border divide-y">
          {history.events.map((ev) => (
            <div key={ev.id} className="p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Rocket className="h-3.5 w-3.5 text-ct-muted" />
                  <span className="text-sm font-medium text-ct-navy">{ev.projectName ?? "unknown project"}</span>
                  <Badge className={`text-[10px] ${EVENT_BADGE[ev.eventType] ?? "bg-ct-cloud text-ct-slate"}`}>
                    {ev.eventType}
                  </Badge>
                  {ev.target && <Badge variant="outline" className="text-[10px]">{ev.target}</Badge>}
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {new Date(ev.receivedAt).toLocaleString()}
                </span>
              </div>
              {ev.deploymentUrl && (
                <p className="text-[11px] text-muted-foreground truncate">{ev.deploymentUrl}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
