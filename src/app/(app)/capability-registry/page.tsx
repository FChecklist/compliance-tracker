"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 43 (VERIDIAN Capability Registry, PLATFORM_STRATEGY.md §24). Two
// on-demand, admin-gated actions: backfill (index everything that existed
// before this wave) and a duplicate audit (surface candidate near-duplicate
// worker agents/automation rules for a human to review -- never merges or
// deletes anything itself).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Database, Search, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type DuplicateCandidate = {
  a: { entityType: string; entityId: string; content: string };
  b: { entityType: string; entityId: string; content: string };
  score: number;
};

export default function CapabilityRegistryPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setIsAdmin(d.role === "admin"));
  }, []);

  const runBackfill = async () => {
    setBackfilling(true);
    try {
      const res = await fetch("/api/capability-registry/backfill", { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(`Indexed ${data.agents} worker agents, ${data.rules} automation rules, ${data.modules} modules`);
    } catch {
      toast.error("Backfill failed");
    } finally {
      setBackfilling(false);
    }
  };

  const runAudit = async () => {
    setAuditing(true);
    try {
      const res = await fetch("/api/capability-registry/duplicates");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDuplicates(data.duplicates ?? []);
    } catch {
      toast.error("Duplicate audit failed");
    } finally {
      setAuditing(false);
    }
  };

  if (!isAdmin) {
    return <p className="text-sm text-ct-muted">This page is only available to organisation admins.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Database className="size-5 text-ct-saffron" />
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Capability Registry</h1>
          <p className="text-sm text-ct-muted mt-1">What VERI FDE checks before ever proposing a new Worker Agent -- a semantic index of every worker agent, automation rule, and module, so requests are matched against what already exists instead of re-deriving the same context every time.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-5 space-y-3">
            <h2 className="text-sm font-semibold text-ct-navy">Backfill index</h2>
            <p className="text-xs text-ct-muted">Index everything created before this wave. Safe to run more than once -- already-indexed capabilities are skipped.</p>
            <Button onClick={runBackfill} disabled={backfilling} size="sm" className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {backfilling ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Database className="size-4 mr-2" />}
              Run Backfill
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-5 space-y-3">
            <h2 className="text-sm font-semibold text-ct-navy">Duplicate audit</h2>
            <p className="text-xs text-ct-muted">Surface capabilities that look like near-duplicates of each other, for you to review -- nothing is ever merged or deleted automatically.</p>
            <Button onClick={runAudit} disabled={auditing} size="sm" variant="outline">
              {auditing ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Search className="size-4 mr-2" />}
              Run Audit
            </Button>
          </CardContent>
        </Card>
      </div>

      {duplicates !== null && (
        <div className="space-y-2">
          {duplicates.length === 0 ? (
            <p className="text-sm text-ct-muted">No likely duplicates found.</p>
          ) : (
            duplicates.map((dup, i) => (
              <Card key={i} className="rounded-xl shadow-card bg-white">
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-4 text-ct-saffron" />
                    <Badge variant="secondary" className="text-xs">{Math.round(dup.score * 100)}% similar</Badge>
                  </div>
                  <p className="text-sm text-ct-navy"><span className="font-semibold">{dup.a.entityType}:</span> {dup.a.content}</p>
                  <p className="text-sm text-ct-navy"><span className="font-semibold">{dup.b.entityType}:</span> {dup.b.content}</p>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
