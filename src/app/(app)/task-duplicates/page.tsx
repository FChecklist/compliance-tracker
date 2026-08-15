"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// VERIDIAN Review Framework gap closure, 2026-07-18 ("Duplicate Work
// Detection" -- no duplicate-task/duplicate-work detection for ordinary
// business tasks, e.g. two people independently starting the same
// compliance filing). On-demand, manager-gated audit -- mirrors
// src/app/(app)/capability-registry/page.tsx's own "surfaces candidates
// for a human to decide, never auto-merges/cancels anything" pattern.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Copy, ScanSearch } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type DuplicateTaskCandidate = {
  a: { taskId: string; title: string; score: number };
  b: { taskId: string; title: string; score: number };
  score: number;
};

export default function TaskDuplicatesPage() {
  const [canScan, setCanScan] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateTaskCandidate[] | null>(null);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setCanScan(d.role === "admin" || d.role === "manager"));
  }, []);

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/tasks/duplicates");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDuplicates(data.duplicates ?? []);
    } catch {
      toast.error("Duplicate task scan failed");
    } finally {
      setScanning(false);
    }
  };

  if (!canScan) {
    return <p className="text-sm text-ct-muted">This page is only available to organisation managers and admins.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Copy className="size-5 text-ct-saffron" />
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Duplicate Task Detection</h1>
          <p className="text-sm text-ct-muted mt-1">Finds active (to-do/in-progress) tasks that look like the same work someone else already started -- e.g. two people independently beginning the same compliance filing. Never cancels or merges anything itself; review each pair and decide.</p>
        </div>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="pt-5 space-y-3">
          <h2 className="text-sm font-semibold text-ct-navy">Scan for duplicate tasks</h2>
          <p className="text-xs text-ct-muted">Compares active tasks in your organisation by semantic similarity (title + description). Each scan costs a real embedding lookup per active task, so this runs on demand rather than automatically.</p>
          <Button onClick={runScan} disabled={scanning} size="sm">
            {scanning ? <Loader2 className="size-4 mr-2 animate-spin" /> : <ScanSearch className="size-4 mr-2" />}
            Scan for duplicate tasks
          </Button>
        </CardContent>
      </Card>

      {duplicates && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-5 space-y-3">
            <h2 className="text-sm font-semibold text-ct-navy">
              {duplicates.length === 0 ? "No likely duplicates found" : `${duplicates.length} possible duplicate pair(s)`}
            </h2>
            {duplicates.map((d, i) => (
              <div key={i} className="border border-ct-border rounded-lg p-3 flex items-center justify-between gap-3">
                <div className="text-sm space-y-1">
                  <p className="text-ct-navy font-medium">{d.a.title}</p>
                  <p className="text-ct-muted text-xs">looks similar to</p>
                  <p className="text-ct-navy font-medium">{d.b.title}</p>
                </div>
                <Badge variant="secondary">{Math.round(d.score * 100)}% match</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
